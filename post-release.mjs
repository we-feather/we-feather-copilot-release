import axios from 'axios'
import { Octokit } from 'octokit'
import { load, dump } from 'js-yaml'
import OSS from 'ali-oss'

const SERVER_BASE_URL = process.env.SERVER_BASE_URL
const SERVER_UPDATE_KEY = process.env.SERVER_UPDATE_KEY
const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const CDN_HOST = process.env.CDN_HOST
const OSS_PATH = process.env.OSS_PATH
const OSS_BUCKET = process.env.OSS_BUCKET
const OSS_REGION = process.env.OSS_REGION
const OSS_ACCESS_KEY_ID = process.env.OSS_ACCESS_KEY_ID
const OSS_ACCESS_KEY_SECRET = process.env.OSS_ACCESS_KEY_SECRET


// 创建可复用的 OSS 客户端实例
const ossClient = new OSS({
  path: OSS_PATH,
  bucket: OSS_BUCKET,
  region: OSS_REGION,
  accessKeyId: OSS_ACCESS_KEY_ID,
  accessKeySecret: OSS_ACCESS_KEY_SECRET,
})

// 创建可复用的 Octokit 实例
const octokit = new Octokit({ auth: GITHUB_TOKEN })

let isPublishVersion = false
async function createClientVersion(version) {
  if (isPublishVersion) return
  const data = { version }
  await axios.post(
    `${SERVER_BASE_URL}/api/client-version`,
    data,
    {
      headers: {
        Authorization: `Bearer ${SERVER_UPDATE_KEY}`,
      },
    },
  )
  isPublishVersion = true
}

async function updateDownloadInfo(filename, data) {
  await axios.post(
    `${SERVER_BASE_URL}/api/download/cache/${filename}`,
    { content: dump(data) },
    {
      headers: {
        Authorization: `Bearer ${SERVER_UPDATE_KEY}`,
      },
    },
  )
}

async function saveToOSS(filename, url) {
  try {
    const response = await axios({ 
      method: 'get', 
      url, 
      responseType: 'stream',
      timeout: 30 * 60 * 1000 // 30分钟超时
    })
    await ossClient.putStream(`/${OSS_PATH}/${filename}`, response.data, {
      timeout: 30 * 60 * 1000 // 30分钟超时
    })
    console.log(`保存文件 ${filename} 到 OSS 成功`)
  } catch (error) {
    console.error(`保存文件 ${filename} 到 OSS 失败:`, error.message)
    throw error
  }
}

async function publishNotify(filename) {
  try {
    const { data: latestReleaseRes } = await octokit.request('/repos/we-feather/we-feather-copilot-release/releases/latest')
    const asset = latestReleaseRes.assets.find((asset) => asset.name === filename)
    if (!asset) throw new Error(`未找到资源文件: ${filename}`)

    // 并行请求 releaseNotes 和 xml 数据
    const [{ data: releaseNotes }, data] = await Promise.all([
      octokit.request('POST /markdown', { text: latestReleaseRes.body, headers: { 'X-GitHub-Api-Version': '2022-11-28' } }),
      axios.get(asset.browser_download_url).then((res) => load(res.data))
    ])

    // 并行处理文件上传
    const uploadPromises = data.files.map(async (file) => {
      const filename = file.url
      const originalUrl = `https://github.com/we-feather/we-feather-copilot-release/releases/download/${latestReleaseRes.tag_name}/${filename}`
      await saveToOSS(filename, originalUrl)
      file.url = `${CDN_HOST}/${OSS_PATH}/${filename}`
    })
    
    await Promise.all(uploadPromises)
    
    data.releaseNotes = releaseNotes
    
    // 并行处理通知操作
    await Promise.all([
      createClientVersion(data.version, data.releaseNotes),
      updateDownloadInfo(filename, data),
    ])
  } catch (error) {
    console.error(`处理文件 ${filename} 失败:`, error.message)
    throw error
  }
}

async function publishNotifyAll() {
  try {
    // 并行处理 Mac 和 Windows 版本
    await Promise.all([
      publishNotify('latest-mac.yml').then(() => console.info('Mac 版本发布成功')),
      publishNotify('latest.yml').then(() => console.info('Windows 版本发布成功'))
    ])
  } catch (error) {
    console.error('发布通知失败:', error)
    process.exit(1)
  }
}

publishNotifyAll()

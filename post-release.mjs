import axios from 'axios'
import { Octokit } from 'octokit'
import { load, dump } from 'js-yaml'

const SERVER_BASE_URL = process.env.SERVER_BASE_URL
const SERVER_UPDATE_KEY = process.env.SERVER_UPDATE_KEY
const GITHUB_TOKEN = process.env.GITHUB_TOKEN

const octokit = new Octokit({ auth: GITHUB_TOKEN })

let isPublishVersion = false

async function createClientVersion(version) {
  if (isPublishVersion) return
  const data = { version }
  console.log('----------------------「上报版本信息」----------------------')
  await axios.post(
    `${SERVER_BASE_URL}/api/client-version`,
    data,
    {
      headers: {
        Authorization: `Bearer ${SERVER_UPDATE_KEY}`,
      },
    },
  )
  console.log(JSON.stringify(data, null, 2))
  isPublishVersion = true
  console.log('----------------------「上报版本信息结束」----------------------')
}

async function updateDownloadInfo(filename, data) {
  console.log('----------------------「上报下载信息」----------------------')
  await axios.post(
    `${SERVER_BASE_URL}/api/download/cache/${filename}`,
    { content: dump(data) },
    {
      headers: {
        Authorization: `Bearer ${SERVER_UPDATE_KEY}`,
      },
    },
  )
  console.log(JSON.stringify(data, null, 2))
  console.log('----------------------「上报下载信息结束」----------------------')
}

async function publishNotify(filename) {
  const { data: latestReleaseRes } = await octokit.request('/repos/we-feather/we-feather-copilot-release/releases/latest')
  const asset = latestReleaseRes.assets.find((asset) => asset.name === filename)
  const { data: releaseNotes } = await octokit.request('POST /markdown', {
    text: latestReleaseRes.body,
    headers: { 'X-GitHub-Api-Version': '2022-11-28' },
  })
  const { data: xml } = await axios.get(asset.browser_download_url)
  const data = load(xml)
  data.files = data.files.map((file) => {
    file.url = `https://gh-proxy.com/github.com/we-feather/we-feather-copilot-release/releases/download/${latestReleaseRes.tag_name}/${file.url}`
    return file
  })
  data.releaseNotes = releaseNotes
  // 上报下载信息
  await updateDownloadInfo(filename, data)
  // 生成版本信息
  await createClientVersion(data.version, data.releaseNotes)
}

async function publishNotifyAll() {
  try {
    await publishNotify('latest-mac.yml')
    console.info('Mac 版本发布成功')
    await publishNotify('latest.yml')
    console.info('Windows 版本发布成功')
  } catch (error) {
    console.error('发布通知失败:', error)
    process.exit(1)
  }
}

publishNotifyAll()

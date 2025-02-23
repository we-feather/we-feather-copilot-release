import axios from 'axios'
import { Octokit } from 'octokit'
import { load, dump } from 'js-yaml'

const SERVER_BASE_URL = process.env.SERVER_BASE_URL
const SERVER_UPDATE_KEY = process.env.SERVER_UPDATE_KEY
const GITHUB_TOKEN = process.env.GITHUB_TOKEN

const octokit = new Octokit({ auth: GITHUB_TOKEN })

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
  console.info(`${SERVER_BASE_URL}/api/download/cache/${filename}`)
  console.log(JSON.stringify(data, null, 2))
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

async function publishNotifyAll() {
  try {
    await publishNotify('latest-mac.yml')
    console.info('Mac 版本发布成功')
    await publishNotify('latest.yml')
    console.info('Windows 版本发布成功')
  } catch (error) {
    console.error('发布通知失败:', error.message)
    process.exit(1)
  }
}

publishNotifyAll()

import { getFrameMetadata } from 'frog/next'
import type { Metadata } from 'next'

export async function generateMetadata(): Promise<Metadata> {
  const frameTags = await getFrameMetadata(
    `${process.env.FRAME_URL || 'http://localhost:3000/'}api`,
  )
  return {
    other: frameTags,
  }
}

export default function Home() {
  return (
    <>
      <h1>go to <a href="https://dtech.vision">dTech</a></h1>
    </>
  )
}

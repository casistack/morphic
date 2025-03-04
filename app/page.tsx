// Force dynamic rendering to allow headers() usage
export const dynamic = 'force-dynamic'

import { Chat } from '@/components/chat'
import { getModels } from '@/lib/config/models'
import { generateId } from 'ai'

export default async function Page() {
  const id = generateId()
  const models = await getModels()
  return <Chat id={id} models={models} />
}

import { Model } from '@/lib/types/models'
import { headers } from 'next/headers'

export function validateModel(model: any): model is Model {
  return (
    typeof model.id === 'string' &&
    typeof model.name === 'string' &&
    typeof model.provider === 'string' &&
    typeof model.providerId === 'string' &&
    typeof model.enabled === 'boolean' &&
    (model.toolCallType === 'native' || model.toolCallType === 'manual') &&
    (model.toolCallModel === undefined ||
      typeof model.toolCallModel === 'string')
  )
}

export async function getModels(): Promise<Model[]> {
  try {
    // Try multiple approaches to get a working base URL
    let baseUrl: URL

    try {
      // First try using headers to get the current request's URL
      const headersList = await headers()
      baseUrl = new URL(headersList.get('x-url') || '')
    } catch (error) {
      // If that fails, use environment variable or default
      const envBaseUrl = process.env.NEXT_PUBLIC_BASE_URL || ''

      if (envBaseUrl) {
        baseUrl = new URL(envBaseUrl)
      } else {
        // Last resort - use relative path which should work in most cases
        baseUrl = new URL('/', 'http://localhost')
      }
    }

    // Use relative URL to avoid cross-origin issues
    const modelUrl = new URL('/config/models.json', baseUrl)

    // Log the URL being used (helpful for debugging)
    console.log(`Fetching models from: ${modelUrl.toString()}`)

    const response = await fetch(modelUrl, {
      cache: 'no-store'
    })

    if (!response.ok) {
      throw new Error(
        `Failed to fetch models: ${response.status} ${response.statusText}`
      )
    }

    const config = await response.json()

    if (Array.isArray(config.models) && config.models.every(validateModel)) {
      return config.models
    }
    console.warn('Invalid model configuration')
  } catch (error) {
    console.warn('Failed to load models:', error)
  }

  return []
}

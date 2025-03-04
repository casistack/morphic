import { Model } from '@/lib/types/models'
import fs from 'fs/promises'
import { headers } from 'next/headers'
import path from 'path'

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
  // First attempt: Try loading from filesystem
  try {
    console.log('Attempting to load models from filesystem')
    const possiblePaths = [
      // Container path
      '/app/public/config/models.json',
      // Current directory path
      path.join(process.cwd(), 'public', 'config', 'models.json')
    ]

    // Try each path until we find the file
    for (const filePath of possiblePaths) {
      try {
        console.log(`Trying path: ${filePath}`)
        const fileContent = await fs.readFile(filePath, 'utf-8')
        const config = JSON.parse(fileContent)

        if (
          Array.isArray(config.models) &&
          config.models.every(validateModel)
        ) {
          console.log(`Successfully loaded models from filesystem: ${filePath}`)
          return config.models
        }
      } catch (err) {
        // Continue to next path if this one fails
        console.log(`Failed to load from ${filePath}`)
      }
    }
  } catch (fsError) {
    console.log('Filesystem loading failed, falling back to URL-based method')
  }

  // Second attempt: The original URL-based method as fallback
  try {
    // Try multiple approaches to get a working base URL
    let baseUrl: URL
    try {
      // First try using headers to get the current request's URL
      const headersList = await headers()
      baseUrl = new URL(headersList.get('x-url') || '')

      // Force HTTP protocol for internal requests to avoid HTTPS issues
      if (baseUrl.hostname === '0.0.0.0') {
        baseUrl.protocol = 'http:'
        baseUrl.hostname = 'localhost'
      }
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
    console.log(`Fetching models from URL: ${modelUrl.toString()}`)

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

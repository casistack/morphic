import { tool } from 'ai'
import { createStreamableValue } from 'ai/rsc'
import Exa from 'exa-js'
import { searchSchema } from '@/lib/schema/search'
import { SearchSection } from '@/components/search-section'
import { ToolProps } from '.'
import { sanitizeUrl } from '@/lib/utils'
import {
  SearchResultImage,
  SearchResults,
  SearchResultItem,
  SearchXNGResponse,
  SearchXNGResult
} from '@/lib/types'
import { PlaywrightCrawler } from 'crawlee'
import { load } from 'cheerio'

export const searchTool = ({ uiStream, fullResponse }: ToolProps) =>
  tool({
    description: 'Search the web for information',
    parameters: searchSchema,
    execute: async ({
      query,
      max_results,
      search_depth,
      include_domains,
      exclude_domains
    }) => {
      let hasError = false
      // Append the search section
      const streamResults = createStreamableValue<string>()
      uiStream.update(
        <SearchSection
          result={streamResults.value}
          includeDomains={include_domains}
        />
      )

      // Tavily API requires a minimum of 5 characters in the query
      const filledQuery =
        query.length < 5 ? query + ' '.repeat(5 - query.length) : query
      let searchResult: SearchResults
      const searchAPI =
        (process.env.SEARCH_API as 'tavily' | 'exa' | 'searchxng') || 'tavily'
      console.log(`Using search API: ${searchAPI}`)

      try {
        searchResult = await (searchAPI === 'tavily'
          ? tavilySearch
          : searchAPI === 'exa'
          ? exaSearch
          : searchXNGSearch)(
          filledQuery,
          max_results,
          search_depth,
          include_domains,
          exclude_domains
        )
      } catch (error) {
        console.error('Search API error:', error)
        hasError = true
        searchResult = {
          results: [],
          query: filledQuery,
          images: [],
          number_of_results: 0
        }
      }

      if (hasError) {
        fullResponse = `An error occurred while searching for "${filledQuery}".`
        uiStream.update(null)
        streamResults.done()
        return searchResult
      }

      streamResults.done(JSON.stringify(searchResult))
      return searchResult
    }
  })

async function tavilySearch(
  query: string,
  maxResults: number = 10,
  searchDepth: 'basic' | 'advanced' = 'basic',
  includeDomains: string[] = [],
  excludeDomains: string[] = []
): Promise<SearchResults> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY is not set in the environment variables')
  }
  const includeImageDescriptions = true
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: Math.max(maxResults, 5),
      search_depth: searchDepth,
      include_images: true,
      include_image_descriptions: includeImageDescriptions,
      include_answers: true,
      include_domains: includeDomains,
      exclude_domains: excludeDomains
    })
  })

  if (!response.ok) {
    throw new Error(
      `Tavily API error: ${response.status} ${response.statusText}`
    )
  }

  const data = await response.json()
  const processedImages = includeImageDescriptions
    ? data.images
        .map(({ url, description }: { url: string; description: string }) => ({
          url: sanitizeUrl(url),
          description
        }))
        .filter(
          (
            image: SearchResultImage
          ): image is { url: string; description: string } =>
            typeof image === 'object' &&
            image.description !== undefined &&
            image.description !== ''
        )
    : data.images.map((url: string) => sanitizeUrl(url))

  return {
    ...data,
    images: processedImages
  }
}

async function exaSearch(
  query: string,
  maxResults: number = 10,
  _searchDepth: string,
  includeDomains: string[] = [],
  excludeDomains: string[] = []
): Promise<SearchResults> {
  const apiKey = process.env.EXA_API_KEY
  if (!apiKey) {
    throw new Error('EXA_API_KEY is not set in the environment variables')
  }

  const exa = new Exa(apiKey)
  const exaResults = await exa.searchAndContents(query, {
    highlights: true,
    numResults: maxResults,
    includeDomains,
    excludeDomains
  })

  return {
    results: exaResults.results.map((result: any) => ({
      title: result.title,
      url: result.url,
      content: result.highlight || result.text
    })),
    query,
    images: [],
    number_of_results: exaResults.results.length
  }
}

async function searchXNGSearch(
  query: string,
  maxResults: number = 10,
  searchDepth: 'basic' | 'advanced' = 'basic',
  includeDomains: string[] = [],
  excludeDomains: string[] = []
): Promise<SearchResults> {
  const apiUrl = process.env.SEARCHXNG_API_URL
  if (!apiUrl) {
    throw new Error('SEARCHXNG_API_URL is not set in the environment variables')
  }

  try {
    // Construct the URL with query parameters
    const url = new URL(`${apiUrl}/search`)
    url.searchParams.append('q', query)
    url.searchParams.append('format', 'json')
    url.searchParams.append('categories', 'general,images')

    // Implement search depth
    if (searchDepth === 'advanced') {
      url.searchParams.append('time_range', '') // No time restriction
      url.searchParams.append('safesearch', '0') // Disable safe search
      // Use more engines for comprehensive results
      url.searchParams.append('engines', 'google,bing,duckduckgo,wikipedia')
    } else {
      url.searchParams.append('time_range', 'year') // Restrict to last year
      url.searchParams.append('safesearch', '1') // Enable safe search
      // Use fewer engines for quicker results
      url.searchParams.append('engines', 'google,bing')
    }

    console.log('url', url)

    // Implement pagination
    const resultsPerPage = 10 // Assuming 10 results per page
    const pageno = Math.ceil(maxResults / resultsPerPage)
    url.searchParams.append('pageno', String(pageno))

    // Implement timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 seconds timeout

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      },
      signal: controller.signal
    })
    clearTimeout(timeoutId)


    if (!response.ok) {
      const errorText = await response.text()
      console.error(`SearchXNG API error (${response.status}):`, errorText)
      throw new Error(
        `SearchXNG API error: ${response.status} ${response.statusText} - ${errorText}`
      )
    }

    const data: SearchXNGResponse = await response.json()

    let generalResults = data.results.filter(result => !result.img_src)
    console.log('generalResults', generalResults)

    if (searchDepth === 'advanced') {
      // Use Crawlee to follow links and gather more content
      const crawler = new PlaywrightCrawler({
        maxRequestsPerCrawl: maxResults * 3, // Limit the number of pages crawled
        async requestHandler({ request, page, enqueueLinks }) {
          const title = await page.title()
          const content = await page.content()
          console.log('content', content)
          console.log('title', title)
          // Use cheerio to parse the HTML and extract relevant text
          const $ = load(content)
          console.log('$', $)
          // Remove script and style elements
          $('script, style').remove()

          // Extract text from body, prioritizing certain elements
          const extractedText = $('body')
            .find('p, h1, h2, h3, h4, h5, h6, li')
            .map((_, el) => $(el).text().trim())
            .get()
            .join('\n')

          // Format the extracted content
          const formattedContent = `
Title: ${title}
URL: ${request.url}
Content:
${extractedText.substring(0, 1000)} // Limit to 1000 characters
        `.trim()

          // Store the data in the crawler's state
          await crawler.pushData({ title, formattedContent, url: request.url })
        }
      })

      console.log('crawler', crawler)

      const crawlPromises = generalResults
        .slice(0, maxResults)
        .map(async result => {
          try {
            await crawler.run([result.url])
            const crawledData = await crawler.getData()
            let additionalContent = ''

            // Check if crawledData is an array
            if (Array.isArray(crawledData)) {
              additionalContent = crawledData
                .map((data: any) => data.formattedContent)
                .join('\n\n---\n\n') // Separate pages with a delimiter
            } else if (
              typeof crawledData === 'object' &&
              crawledData !== null
            ) {
              // If it's an object, we'll assume it has a 'items' property that is an array
              additionalContent = (crawledData.items as any[])
                .map((data: any) => data.formattedContent)
                .join('\n\n---\n\n')
            }

            result.content += '\n\nAdditional content:\n' + additionalContent
          } catch (error) {
            console.error(`Error crawling ${result.url}:`, error)
          }
        })

      await Promise.all(crawlPromises)
    }

    generalResults = generalResults.slice(0, maxResults)

    console.log('generalResults', generalResults)

    // Separate general results and image results, and limit to maxResults
    const imageResults = data.results
      .filter(result => result.img_src)
      .slice(0, maxResults)

    // Format the results to match the expected SearchResults structure
    return {
      results: generalResults.map(
        (result: SearchXNGResult): SearchResultItem => ({
          title: result.title,
          url: result.url,
          content: result.content
        })
      ),
      query: data.query,
      images: imageResults
        .map(result => {
          const imgSrc = result.img_src || ''
          return imgSrc.startsWith('http') ? imgSrc : `${apiUrl}${imgSrc}`
        })
        .filter(Boolean),
      number_of_results: data.number_of_results
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('SearchXNG API request timed out')
      throw new Error('SearchXNG API request timed out')
    }
    console.error('SearchXNG API error:', error)
    throw error
  }
}

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROMPT_DIR_CANDIDATES = [
  fileURLToPath(new URL('./prompt-resources', import.meta.url)),
  path.resolve(process.cwd(), 'backend/src/analysis/prompt-resources'),
]

const promptCache = new Map<string, string>()

function loadPromptResource(name: string): string {
  const cached = promptCache.get(name)
  if (cached) {
    return cached
  }

  for (const directory of PROMPT_DIR_CANDIDATES) {
    const filePath = path.join(directory, name)
    if (!fs.existsSync(filePath)) {
      continue
    }
    const content = fs.readFileSync(filePath, 'utf8')
    promptCache.set(name, content)
    return content
  }

  throw new Error(`Prompt resource not found: ${name}`)
}

export function renderPromptResource(
  name: string,
  variables: Record<string, string | number | null | undefined>,
): string {
  const template = loadPromptResource(name)
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key: string) => {
    const value = variables[key]
    return value == null ? '' : String(value)
  })
}
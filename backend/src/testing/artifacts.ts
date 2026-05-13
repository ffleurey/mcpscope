import fs from 'node:fs'
import path from 'node:path'

const artifactsDir = path.join(process.cwd(), 'backend-data', 'test-artifacts')

export function writeIntegrationArtifact(name: string, payload: unknown): void {
  fs.mkdirSync(artifactsDir, { recursive: true })
  const filePath = path.join(artifactsDir, `${name}.json`)
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

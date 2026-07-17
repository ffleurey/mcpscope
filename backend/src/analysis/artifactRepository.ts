/**
 * Artifact repository for the analysis v2 workflow.
 *
 * Provides typed read/write access to the `artifacts` table for JSON artifacts
 * produced by the analysis workflow. All analysis artifacts are stored with
 * artifact_type_key = 'json'.
 */

import type { BackendConnection } from "mcpscope-engine/persistence/connection.js";

export interface ArtifactRecord {
  readonly id: string
  readonly sessionId: string
  readonly stepId: string | null
  /** Serialized JSON content of the artifact. */
  readonly content: unknown
  /** Semantic metadata: schema_key, target identifiers, etc. */
  readonly metadata: Record<string, unknown>
  readonly createdAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Write
// ─────────────────────────────────────────────────────────────────────────────

export function insertJsonArtifact(
  connection: BackendConnection,
  record: ArtifactRecord,
): void {
  connection.prepare(`
    INSERT INTO artifacts (
      id, session_id, step_id, artifact_type_key,
      content_json, metadata_json, created_at
    ) VALUES (
      @id, @sessionId, @stepId, 'json',
      @contentJson, @metadataJson, @createdAt
    )
  `).run({
    id: record.id,
    sessionId: record.sessionId,
    stepId: record.stepId,
    contentJson: JSON.stringify(record.content),
    metadataJson: JSON.stringify(record.metadata),
    createdAt: record.createdAt,
  })
}

export function deleteJsonArtifact(
  connection: BackendConnection,
  id: string,
): void {
  connection.prepare(`DELETE FROM artifacts WHERE id = ?`).run(id)
}

// ─────────────────────────────────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────────────────────────────────

export function listArtifactsBySession(
  connection: BackendConnection,
  sessionId: string,
): ArtifactRecord[] {
  const rows = connection.prepare(`
    SELECT id, session_id, step_id, content_json, metadata_json, created_at
    FROM artifacts
    WHERE session_id = ?
      AND artifact_type_key = 'json'
    ORDER BY created_at ASC
  `).all(sessionId) as Array<{
    id: string
    session_id: string
    step_id: string | null
    content_json: string | null
    metadata_json: string | null
    created_at: number
  }>

  return rows.map(mapArtifactRow)
}

export function listArtifactsBySessionAndSchemaKey(
  connection: BackendConnection,
  sessionId: string,
  schemaKey: string,
): ArtifactRecord[] {
  const all = listArtifactsBySession(connection, sessionId)
  return all.filter(r => (r.metadata as { schema_key?: string }).schema_key === schemaKey)
}

export function getLatestArtifactBySchemaKey(
  connection: BackendConnection,
  sessionId: string,
  schemaKey: string,
): ArtifactRecord | null {
  const matching = listArtifactsBySessionAndSchemaKey(connection, sessionId, schemaKey)
  return matching.length > 0 ? (matching[matching.length - 1] ?? null) : null
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function mapArtifactRow(row: {
  id: string
  session_id: string
  step_id: string | null
  content_json: string | null
  metadata_json: string | null
  created_at: number
}): ArtifactRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    stepId: row.step_id,
    content: row.content_json ? JSON.parse(row.content_json) : null,
    metadata: row.metadata_json ? (JSON.parse(row.metadata_json) as Record<string, unknown>) : {},
    createdAt: row.created_at,
  }
}

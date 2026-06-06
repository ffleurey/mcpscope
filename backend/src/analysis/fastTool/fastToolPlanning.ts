import type { EvidencePacket, FastToolWorkGroup, FastToolWorkIndex } from '../schemas.js'

export function buildFastToolWorkIndex(packets: EvidencePacket[]): FastToolWorkIndex {
  const groupsByTool = new Map<string, FastToolWorkGroup>()

  for (const packet of packets) {
    const existing = groupsByTool.get(packet.tool_name)
    if (!existing) {
      groupsByTool.set(packet.tool_name, {
        work_unit_id: `tool-group-${groupsByTool.size + 1}`,
        tool_name: packet.tool_name,
        tool_call_part_ids: [packet.tool_call_part_id],
        tool_result_part_ids: packet.tool_result_part_id ? [packet.tool_result_part_id] : [],
        reasoning_before_part_ids: packet.reasoning_before_part_id ? [packet.reasoning_before_part_id] : [],
        reasoning_after_part_ids: packet.reasoning_after_part_id ? [packet.reasoning_after_part_id] : [],
        turn_ids: [packet.turn_id],
        round_ids: [packet.round_id],
      })
      continue
    }

    pushUnique(existing.tool_call_part_ids, packet.tool_call_part_id)
    if (packet.tool_result_part_id) pushUnique(existing.tool_result_part_ids, packet.tool_result_part_id)
    if (packet.reasoning_before_part_id) pushUnique(existing.reasoning_before_part_ids, packet.reasoning_before_part_id)
    if (packet.reasoning_after_part_id) pushUnique(existing.reasoning_after_part_ids, packet.reasoning_after_part_id)
    pushUnique(existing.turn_ids, packet.turn_id)
    pushUnique(existing.round_ids, packet.round_id)
  }

  return { tool_groups: [...groupsByTool.values()] }
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value)
  }
}

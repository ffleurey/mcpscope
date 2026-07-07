export const CONTEXT_SIZE_PRESETS = [
  { value: 16384, label: '16K (16,384)' },
  { value: 24576, label: '24K (24,576)' },
  { value: 32768, label: '32K (32,768)' },
  { value: 49152, label: '48K (49,152)' },
  { value: 65536, label: '64K (65,536)' },
  { value: 81920, label: '80K (81,920)' },
  { value: 98304, label: '96K (98,304)' },
  { value: 131072, label: '128K (131,072)' },
]

export function formatContextSize(value: number | undefined): string | null {
  if (value == null) return null
  const preset = CONTEXT_SIZE_PRESETS.find((p) => p.value === value)
  if (preset) return preset.label
  return value.toLocaleString()
}

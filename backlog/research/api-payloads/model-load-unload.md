# LM Studio Model Load/Unload API

**Endpoint prefix:** `{root}/api/v1/models/`  
**Auth:** `Authorization: Bearer {apiKey}` (required when API key is set)

---

## Load a model

```
POST /api/v1/models/load
Content-Type: application/json

{ "model": "google/gemma-4-e4b" }
```

**Response (success, ~3 seconds):**
```json
{
  "type": "llm",
  "instance_id": "google/gemma-4-e4b",
  "load_time_seconds": 3.033,
  "status": "loaded"
}
```

Notes:
- The `instance_id` is the same as the model key in practice
- Loading a model may unload the currently loaded model (VRAM limit)
- The response is synchronous — it blocks until the model is ready
- Re-loading an already-loaded model succeeds instantly (no-op)

**Error (model not found or failed to load):**
```json
{ "error": { "type": "model_load_failed", "message": "Failed to load LLM '...': ..." } }
```

---

## Unload a model

```
POST /api/v1/models/unload
Content-Type: application/json

{ "instance_id": "google/gemma-4-e4b" }
```

**Response:**
```json
{ "instance_id": "google/gemma-4-e4b" }
```

Notes:
- The `instance_id` must be the model key (same as used in `/api/v1/models` list)
- After unloading, context length and loaded status reset in `/api/v1/models`

---

## Check loaded status

```
GET /api/v1/models
```

A model is loaded when its `loaded_instances` array is non-empty.  
The actual (configured) context length is at `loaded_instances[0].config.context_length`.

See `lms-api-v1-models.json` for the full response shape.

---

## What `loaded_instances` gives you

```json
{
  "loaded_instances": [
    {
      "id": "google/gemma-4-e4b",
      "config": {
        "context_length": 4096,        // actual loaded ctx — the real operational limit
        "eval_batch_size": 512,
        "parallel": 4,
        "flash_attention": true,
        "offload_kv_cache_to_gpu": true
      },
      "remaining_ttl_seconds": 3589   // auto-unloads after idle; resets on each request
    }
  ]
}
```

`context_length` here is what was configured at load time — may be much smaller than  
`max_context_length` (the architectural maximum). Always use the loaded value for context bar.

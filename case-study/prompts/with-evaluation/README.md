# V1 Benchmark Seed Set

This folder is the fresh starting point for the V1 benchmark.

It is intentionally separate from the earlier standalone prompts so prompt selection can start from:

- the current Oslo HA inventory
- the current MCP tool surface
- the V1 goals around context budget, reliability, and evaluator-facing coverage

## Inventory-led benchmark design

The current Oslo test instance exposes these main benchmark-relevant families:

- climate sensors across several assigned areas: Cave, Chambre, Kitchen, Olivia, Outdoor, Sacha, Salon
- appliance and load devices with energy/power metrics: Car Charging Plug, Water Heater, Chauffage Salon, Chauffage Chambre, Chauffage Olivia, Chauffage Sacha
- house-level electricity metering: AMS reader
- motion/presence devices: Motion #1 - Haut, Motion #2 - Bas, OSL motion devices, Everything Presence Lite, Seeed Studio MR60BHA2, ESP32-C6-LitterBox
- current-state-only and device-tracker style devices, mostly outside long-term-statistics workflows

## Question families we should be able to ask

### 1. Climate and room conditions

Representative user questions:

- what is the current temperature or humidity in a room?
- what was the min / max / average temperature in a room over a period?
- which room was coldest or most humid over a period?
- how do several rooms compare over the same period?
- how many days were below freezing outdoors?

Typical HA targets in Oslo:

- Ruuvi Outdoor
- Ruuvi Salon
- Ruuvi Cave
- Ruuvi Olivia
- Ruuvi Sacha
- SONOFF SNZB-02D #1
- SONOFF SNZB-02D #2

Expected MCP path:

- discovery path or direct entity lookup
- `ha_history_get_sensor_stats`
- sometimes `ha_history_get_state` for current readings

### 2. Appliance power, energy, and usage

Representative user questions:

- how much energy did an appliance use over a period?
- what is its current power draw?
- when was it active, and for how long?
- what were the biggest usage sessions?
- compare two appliances over the same period

Typical HA targets in Oslo:

- Car Charging Plug
- Water Heater
- Chauffage Salon
- Chauffage Chambre
- Chauffage Olivia
- Chauffage Sacha

Expected MCP path:

- discovery path
- `ha_history_get_consumption`
- `ha_history_detect_sessions`
- sometimes `ha_history_get_sensor_stats`
- sometimes `ha_history_get_state`

### 3. Motion, presence, and occupancy-like questions

Representative user questions:

- when was motion last detected in an area?
- what times of day is an area usually active?
- was a space occupied overnight?
- what happened on the stairs last night?

Typical HA targets in Oslo:

- Motion #1 - Haut
- Motion #2 - Bas
- OSL - Exterieur
- OSL - Cuisine/Salon
- Everything Presence Lite 2c8a14
- Seeed Studio MR60BHA2 Kit 613c2c

Expected MCP path:

- discovery path
- `ha_history_get_state_history`
- sometimes `ha_history_get_state`

### 4. Whole-home electricity and utility questions

Representative user questions:

- how much electricity did the house use over a period?
- when was whole-home demand highest?
- how does this week compare with the previous one?
- which days had the highest usage?

Typical HA target in Oslo:

- AMS reader

Expected MCP path:

- discovery path or direct entity lookup
- `ha_history_get_consumption`
- `ha_history_get_sensor_stats`

### 5. Current-state and direct lookup questions

Representative user questions:

- what is the current state of a known entity?
- what entities exist for a known room/device concept?
- what device should be used for a given area or appliance?

Expected MCP path:

- `ha_history_list_areas`
- `ha_history_list_devices`
- `ha_history_list_device_entities`
- `ha_history_list_entities`
- `ha_history_get_state`

## Tool crosscheck

The current tool surface maps reasonably well to the V1 benchmark families:

- discovery: `ha_history_list_areas`, `ha_history_list_devices`, `ha_history_list_device_entities`
- direct entity lookup: `ha_history_list_entities`
- numeric historical analytics: `ha_history_get_sensor_stats`
- cumulative consumption: `ha_history_get_consumption`
- threshold/session analysis: `ha_history_detect_sessions`
- discrete-state timelines: `ha_history_get_state_history`
- current point-in-time state: `ha_history_get_state`

### Important benchmark implication

The benchmark should not be only about whether the final answer is correct.
It should also measure whether the model chose the right discovery path and the right analytics tool
for the kind of question being asked.

## Grouping for the first V1 benchmark wave

The first fresh V1 wave should group prompts into these families:

- climate multi-area comparison
- appliance composite energy/session summary
- motion/presence timeline
- person/location tracker summary
- whole-home meter summary
- direct current-state lookup
- recovery prompt with ambiguous phrasing

These groups are broad enough to reflect the Oslo installation while still being compact enough for
iterative benchmarking during context/tool compaction.

## Initial seed prompts in this folder

- `01-climate-discovery-matrix.txt`
- `02-appliance-energy-sessions.txt`
- `03-stairs-motion-daily-summary.txt`
- `04-person-away-from-home.txt`

Each prompt file is structured in two sections:

- `## Prompt`: the text that should be sent to the model
- `## Evaluation Criteria`: the expected solve path, success criteria, and follow-up expectations for reviewers

The benchmark runner must send only the `## Prompt` section to the model.

These prompts are intentionally discovery-heavy and composite. They are not the full V1 suite,
but they are a good seed because they exercise the most important V1 behavior:

- finding the right area/device/entity without exact entity IDs
- choosing between statistics, consumption, session, and state-history tools correctly
- producing compact, evaluator-friendly answers

## Expected Solve Shape

These prompts should have an expected solution outline and rough tool-call budget so evaluation can
measure path quality, not only final-answer quality.

### `01-climate-discovery-matrix.txt`

Expected discovery/analytics path:

1. optional `ha_history_get_current_time`
2. `ha_history_list_entities` once with all target areas and `device_classes=["temperature","humidity"]`,
	or twice with one call for `temperature` and one for `humidity`
3. `ha_history_get_sensor_stats` once for temperature entities with `aggregations=["mean","min","max"]`
	for whole-period comparison, or three calls with `aggregation="mean"|"min"|"max"` if daily series is required
4. `ha_history_get_sensor_stats` once for humidity entities with `aggregation="mean"`

Target budget: 3 to 4 tool calls when whole-period comparison is acceptable; still bounded and
intentional if daily series requires separate statistics calls.

### `02-appliance-energy-sessions.txt`

Expected discovery/analytics path:

1. optional `ha_history_get_current_time`
2. `ha_history_list_entities` or `ha_history_list_devices` to resolve the EV charger power and energy entities
3. `ha_history_get_consumption` for total energy
4. `ha_history_detect_sessions` for session count and compact session summary

Target budget: 3 to 4 tool calls.

### `03-stairs-motion-daily-summary.txt`

Expected discovery/analytics path:

1. optional `ha_history_get_current_time`
2. `ha_history_list_devices` once for the stairs or entrance motion devices, or one tight `ha_history_list_entities`
	call if it directly resolves both binary sensors
3. `ha_history_list_device_entities` once per motion device with `metric="motion"` when device discovery is used
4. `ha_history_get_state_history` once per motion sensor with `state_value="on"`, `group_by="day"`, and `start_time="7d"`

Target budget: 4 to 5 tool calls. The key quality check is choosing state history for binary sensors
instead of numeric statistics or threshold sessions.

### `04-person-away-from-home.txt`

Expected discovery/analytics path:

1. optional `ha_history_get_current_time`
2. `ha_history_list_entities` once with `domain="person"` or `domain="device_tracker"` and a tight Olivia search
3. optional `ha_history_get_state` once to confirm the chosen entity
4. `ha_history_get_state_history` once with `state_value="not_home"`, `group_by="day"`, and `start_time="this week"`

Target budget: 2 to 4 tool calls. The key quality check is discovering the correct person-tracking
entity rather than getting lost in companion-app phone sensors.

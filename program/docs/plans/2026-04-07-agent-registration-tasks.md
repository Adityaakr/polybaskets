# Agent Registration Tasks

## T1: Add types, state, errors, events to lib.rs
- Add `AgentInfo` struct
- Add `agents: Vec<AgentInfo>` to `State` and `Default` impl
- Add error variants: `AgentNameTooShort`, `AgentNameTooLong`, `AgentNameInvalid`, `AgentNameTaken`, `AgentRenameCooldown`
- Add event variants: `AgentRegistered`, `AgentRenamed`
- Add constants: `MAX_AGENT_NAME_LEN`, `MIN_AGENT_NAME_LEN`, `AGENT_RENAME_COOLDOWN_MS`

## T2: Add helper methods
- `agent_index(&self, address) -> Option<usize>`
- `is_agent_name_taken(&self, name, exclude) -> bool`
- `validate_agent_name(name) -> Result<(), Error>` (static)

## T3: Add service methods
- `register_agent(&mut self, name: String) -> Result<(), Error>` (mutation, exported)
- `get_agent(&self, address: ActorId) -> Option<AgentInfo>` (query)
- `get_all_agents(&self) -> Vec<AgentInfo>` (query)
- `get_agent_count(&self) -> u64` (query)

## T4: Add gtest tests
- Register agent happy path
- Invalid name variants (too short, too long, special chars, leading/trailing hyphen)
- Duplicate name rejection
- Rename within cooldown rejection
- Rename after cooldown success
- Query single and all agents

## T5: Rebuild IDL and update generated client
- `cargo build --release` in program/
- Copy updated IDL to skills/idl/
- Regenerate basket-market-client if needed

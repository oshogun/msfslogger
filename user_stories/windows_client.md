## User Story: Windows UI Client (Tauri)

### Story
As a pilot running Microsoft Flight Simulator on my Windows machine,  
I want a proper UI-based client instead of the current CLI Node.js agent,  
so that I can configure backend connectivity graphically and have a more immersive in-sim experience.

### Context
- Current state: backend connection is made via CLI flags and environment variables.
- Problem: functional, but not user-friendly and limited for broader pilot usage.
- Desired state: a lightweight desktop app with a graphical setup and status workflow.

### Requirements
1. Build the Windows client using **Tauri**.
2. Provide a **graphical configuration UI** for all connection settings currently passed via flags/env vars.
3. Display connection state using FMC-like terminology, including **"ACARS UPLINK"** when connected.
4. Apply a **skeuomorphic aircraft FMC-inspired interface** to improve immersion.

### Acceptance Criteria
- [ ] A Tauri-based Windows desktop client can connect to the backend server.
- [ ] Users can configure connection settings entirely through the UI (no required CLI/env vars).
- [ ] Connection status visibly changes in the UI, with connected state labeled **ACARS UPLINK**.
- [ ] UI style and labels reflect an FMC-inspired, aviation-themed interaction model.
- [ ] Existing CLI agent functionality is functionally matched for connection/configuration behavior.


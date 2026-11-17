# Tab Audio Router

Chrome (MV3) extension: route each tab's audio to a different output device.

## Install
1. `chrome://extensions` → enable Developer mode → **Load unpacked** → select this folder.
2. Click the extension icon → **Grant device access** (once; reveals device names).
3. Play audio in tabs; pick an output device per tab in the popup.

## Features
- Per-tab output device + volume + mute
- Current tab highlighted and listed first; optional "Show all tabs"
- Badge shows how many tabs are routed; "Stop all" button
- Falls back to default output if a routed device is unplugged
- Remembers last device per site (shown as a hint)

## How it works
`tabCapture` stream id → offscreen document → `AudioContext({sinkId})` → chosen device.
Capturing a tab mutes its normal output, so routed audio only plays on the chosen device.
Select "Default" to stop routing (tab returns to normal output).

## Limits
- Chrome 116+. A tab must be audible (or already routed) to appear in the list.
- Starting a capture requires the extension to be invoked on that tab (click the icon while on it)
  — Chrome's `tabCapture` rule; if you get an "activeTab" error, open the popup from that tab.

// A global variable to keep track of the tab the debugger is attached to.
let attachedTarget = null;

/**
 * Ensures the Chrome Debugger is attached to a specific tab.
 * Attaches the debugger if it's not already attached to the target tab.
 * @param {number} tabId The ID of the tab to attach the debugger to.
 * @returns {Promise<void>} A promise that resolves when the debugger is attached.
 */
async function ensureDebuggerAttached(tabId) {
    if (attachedTarget?.tabId === tabId) {
        // Already attached to the correct tab
        return;
    }

    // Detach from any previous target
    if (attachedTarget) {
        try {
            await chrome.debugger.detach(attachedTarget);
        } catch (e) {
            console.warn(`[Λbstract] Failed to detach from previous target: ${e.message}`);
        }
        attachedTarget = null;
    }

    const newTarget = { tabId: tabId };
    const debuggeeVersion = "1.2";

    try {
        await chrome.debugger.attach(newTarget, debuggeeVersion);
        attachedTarget = newTarget;
        console.log("[Λbstract] Debugger attached");
    } catch (e) {
        console.warn(`[Λbstract] Failed to attach: ${e.message}`);
        attachedTarget = null;
        // Re-throw the error to be caught by the caller
        throw e;
    }
}

/**
 * Simulates a mouse click at specified coordinates in a Wolvesville tab.
 * @param {number} x The x-coordinate for the click.
 * @param {number} y The y-coordinate for the click.
 * @param {string} [button='left'] The mouse button to use ('left', 'right', 'middle').
 * @returns {Promise<void>} A promise that resolves when the click has been dispatched.
 */
async function performClick(x, y, button = 'left') {
    const [tab] = await chrome.tabs.query({ url: "*://*.wolvesville.com/*" });

    if (!tab) {
        console.warn("[Λbstract] No Wolvesville tab found");
        throw new Error("No Wolvesville tab found");
    }

    await ensureDebuggerAttached(tab.id);

    const commonMouseEventParams = {
        button: button,
        x: x,
        y: y,
        clickCount: 1,
    };
    
    // Simulate a sequence of mouse events for a realistic click
    await chrome.debugger.sendCommand(attachedTarget, "Input.dispatchMouseEvent", {
        ...commonMouseEventParams,
        type: 'mouseMoved',
        clickCount: 0 // move doesn't have a click count
    });
    await chrome.debugger.sendCommand(attachedTarget, "Input.dispatchMouseEvent", {
        ...commonMouseEventParams,
        type: 'mousePressed'
    });
    await chrome.debugger.sendCommand(attachedTarget, "Input.dispatchMouseEvent", {
        ...commonMouseEventParams,
        type: 'mouseReleased'
    });
}

/**
 * Listens for messages from other parts of the extension.
 * Handles the 'performClick' action.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action !== 'performClick') {
        return; // Not a message for us
    }

    console.log(`[Λbstract] Background will click at ${message.x}, ${message.y}`);
    
    performClick(message.x, message.y, message.button)
        .then(() => {
            sendResponse({ ok: true });
        })
        .catch(error => {
            sendResponse({ ok: false, error: error.message });
        });

    // Return true to indicate we will respond asynchronously
    return true; 
});

/**
 * Cleans up by detaching the debugger when the extension is suspended.
 */
chrome.runtime.onSuspend.addListener(() => {
    if (attachedTarget) {
        chrome.debugger.detach(attachedTarget).catch(e => {
            // It might fail if the tab is already closed, so just log a warning.
             console.warn(`[Λbstract] Could not detach debugger on suspend: ${e.message}`);
        });
        attachedTarget = null;
    }
});
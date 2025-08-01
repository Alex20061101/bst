/**
 * This file controls the logic for the "Λbstract" extension's popup UI.
 */

document.addEventListener('DOMContentLoaded', () => {


(() => {
    // --- Constants and Configuration ---
    const API_VERIFY_URL = 'https://abstract-project.onrender.com/api/verify-name';
    const STORAGE_KEY_NAME = 'abstract_name';
    const STORAGE_KEY_STATE = 'abstract_state';
    const STORAGE_KEY_START_TIME = 'abstract_start';

    // --- Element Selectors ---
    const getEl = id => document.getElementById(id);
    const toggleBotBtn = getEl('toggleBot');

    const playIconEl = getEl('playIcon');
    const timerEl = getEl('timer');
    const botStatusDotEl = getEl('botStatusDot');
    const botStatusTextEl = getEl('botStatusText');

    const activeNameEl = getEl('activeName');
    const nameInputEl = getEl('nameInput');
    const nameEditContainer = getEl('nameEditContainer');
    const editNameBtn = getEl('editName');
    const confirmNameBtn = getEl('confirmName');

    // --- State Variables ---
    let sessionTimerInterval = null;

    // --- Utility Functions ---

    /**
     * Formats a number to be two digits, padding with a leading zero if needed.
     * @param {number} num The number to format.
     * @returns {string}
     */
    const padZero = (num) => num.toString().padStart(2, '0');

    /**
     * Formats a duration in milliseconds to a HH:MM:SS string.
     * @param {number} ms The duration in milliseconds.
     * @returns {string}
     */
    const formatDuration = (ms) => {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return `${padZero(hours)}:${padZero(minutes)}:${padZero(seconds)}`;
    };

    /**
     * Starts or stops the session timer display.
     * @param {number | null} startTime The timestamp when the session started, or null to stop.
     */
    function updateSessionTimer(startTime) {
        clearInterval(sessionTimerInterval);
        if (!startTime) {
            timerEl.textContent = '00:00:00';
            return;
        }
        timerEl.textContent = formatDuration(Date.now() - startTime);
        sessionTimerInterval = setInterval(() => {
            timerEl.textContent = formatDuration(Date.now() - startTime);
        }, 1000);
    }

    // --- Event Listeners and Initialization ---

    // Load initial state from storage
    chrome.storage.local.get([STORAGE_KEY_NAME, STORAGE_KEY_STATE, STORAGE_KEY_START_TIME], async (storage) => {
        const name = storage[STORAGE_KEY_NAME] || 'Player';
        const isRunning = storage[STORAGE_KEY_STATE] || false;
        const startTime = storage[STORAGE_KEY_START_TIME] || null;

        activeNameEl.textContent = name;
        updateBotStatusUI(isRunning);
        updateSessionTimer(isRunning ? startTime : null);
    });

    // Toggle Bot button
    toggleBotBtn.addEventListener('click', async () => {
        const currentName = activeNameEl.textContent;
        chrome.storage.local.get([STORAGE_KEY_STATE, STORAGE_KEY_START_TIME], (storage) => {
            const newRunningState = !storage[STORAGE_KEY_STATE];
            const newStartTime = Date.now();
            const itemsToSet = { [STORAGE_KEY_STATE]: newRunningState };
            if (newRunningState) {
                itemsToSet[STORAGE_KEY_START_TIME] = newStartTime;
            }

            chrome.storage.local.set(itemsToSet, () => {
                updateBotStatusUI(newRunningState);
                updateSessionTimer(newRunningState ? newStartTime : null);

                // Send message to content script
                chrome.tabs.query({ url: '*://*.wolvesville.com/*' }, (tabs) => {
                    const gameTab = tabs[0];
                    if (!gameTab) return;
                    chrome.tabs.sendMessage(gameTab.id, {
                        action: 'toggleBot',
                        enabled: newRunningState,
                        name: currentName,
                    });
                });
            });
        });
    });

    editNameBtn.onclick = () => {
        nameInputEl.value = activeNameEl.textContent;
        activeNameEl.hidden = true;
        editNameBtn.hidden = true;
        nameEditContainer.style.display = 'flex'; // Use flex for better alignment
        nameInputEl.focus();
    };

    confirmNameBtn.onclick = async () => {
        const newName = nameInputEl.value.substring(0, 14) || 'Player';

        chrome.storage.local.set({ [STORAGE_KEY_NAME]: newName });

        activeNameEl.textContent = newName;
        nameEditContainer.style.display = 'none';
        activeNameEl.hidden = false;
        editNameBtn.hidden = false;
        
    };

    nameInputEl.addEventListener('keydown', _0x36d709 => {
        if (_0x36d709.key === 'Enter') {
            confirmNameBtn.onclick();
        }
    });



    /**
     * Updates the UI to reflect the bot's running state.
     * @param {boolean} isRunning Whether the bot is currently active.
     */
    function updateBotStatusUI(isRunning) {
        botStatusTextEl.textContent = isRunning ? 'Enabled' : 'Disabled';
        botStatusDotEl.classList.toggle('running', isRunning);
        playIconEl.textContent = isRunning ? '⏸' : '▶';
    }
})();

});
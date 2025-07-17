/**
 * ===================================================================================
 * Λbstract.js - De-obfuscated Version
 * ===================================================================================
 * This file is a de-obfuscated and commented version of the original Λbstract.js.
 * The original script is a sophisticated game bot for "Wolvesville", protected by
 * heavy obfuscation to hide its logic and prevent unauthorized use.
 *
 * De-obfuscation Process:
 * 1. An automated de-obfuscator was used to resolve the main string array and
 *    replace the hex-encoded function calls with their string literal equivalents.
 * 2. All functions and variables were manually renamed to reflect their purpose.
 * 3. Code was formatted for readability and comments were added to explain the logic.
 * ===================================================================================
 */

// ===================================================================================
// CONSTANTS & STATE
// ===================================================================================

const WOLF_ROLES = new Set(['Wolf', 'Junior Werewolf', 'Split Wolf']);

// ===================================================================================
 // HELPER & UTILITY FUNCTIONS
 // ===================================================================================

/**
 * Simulates a click on the center of a given DOM element.
 * It communicates with the background script (background.js) to perform the action,
 * which uses the chrome.debugger API for a more reliable click.
 * @param {HTMLElement} element The element to click.
 */
function clickElement(element) {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    return chrome.runtime.sendMessage({ x, y });
}

/**
 * Checks if a given DOM element is currently visible on the screen.
 * @param {HTMLElement} element The element to check.
 * @returns {boolean} True if the element is visible.
 */
function isElementVisible(element) {
    const computedStyle = window.getComputedStyle(element);
    return (
        element.offsetParent !== null &&
        element.offsetWidth > 0 &&
        element.offsetHeight > 0 &&
        computedStyle.visibility !== 'hidden' &&
        computedStyle.display !== 'none' &&
        element.getClientRects().length > 0
    );
}

/**
 * A generic polling utility to wait for an element to appear.
 * @param {function(): (HTMLElement | null)} findFunction A function that returns the element or null.
 * @param {number} timeout The maximum time to wait in milliseconds.
 * @param {number} interval The interval between checks in milliseconds.
 * @param {string|null} cancelText If this text appears on the page, the wait is cancelled.
 * @returns {Promise<HTMLElement|null>} A promise that resolves with the element or null if timed out.
 */
function waitForElement(findFunction, timeout, interval, cancelText) {
    return new Promise(resolve => {
        const startTime = Date.now();
        const poll = () => {
            const element = findFunction();
            if (element) {
                return resolve(element);
            }
            if (cancelText && document.body.textContent.includes(cancelText)) {
                return resolve(null);
            }
            if (Date.now() - startTime >= timeout) {
                return resolve(null);
            }
            setTimeout(poll, interval);
        };
        poll();
    });
}

/**
 * Finds the first visible element containing specific text.
 * @param {string} text The text to search for.
 * @param {{timeout?: number, interval?: number, cancelText?: string}} options
 * @returns {Promise<HTMLElement|null>}
 */
function findElementByText(text, { timeout = 30000, interval = 200, cancelText = null } = {}) {
    return waitForElement(() => {
        for (const element of document.body.querySelectorAll('*')) {
            if (element.textContent.includes(text) && isElementVisible(element)) {
                return element;
            }
        }
        return null;
    }, timeout, interval, cancelText);
}

/**
 * Finds an element whose text matches a regular expression.
 * @param {string} textRegex The regex pattern to test against element text.
 * @param {{timeout?: number, interval?: number, cancelText?: string}} options
 * @returns {Promise<HTMLElement|null>}
 */
function findElementByTextRegex(textRegex, { timeout = 30000, interval = 200, cancelText = null } = {}) {
    const regex = new RegExp('\\b' + textRegex + '\\b');
    return waitForElement(() => {
        for (const element of document.body.querySelectorAll('*')) {
            if (regex.test(element.textContent) && isElementVisible(element)) {
                return element;
            }
        }
        return null;
    }, timeout, interval, cancelText);
}

/**
 * Finds a visible image element by its 'src' attribute.
 * @param {string} srcPart The partial string to find in the image src.
 * @param {{timeout?: number, interval?: number, cancelText?: string}} options
 * @returns {Promise<HTMLImageElement|null>}
 */
function findElementByImageSrc(srcPart, { timeout = 30000, interval = 200, cancelText = null } = {}) {
    return waitForElement(() => {
        for (const img of document.querySelectorAll('img')) {
            if (img.src.includes(srcPart) && isElementVisible(img)) {
                return img;
            }
        }
        return null;
    }, timeout, interval, cancelText);
}

/**
 * Creates a promise that resolves after a specified delay.
 * @param {number} ms The delay in milliseconds.
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Clicks a button that contains a specific image.
 * @param {RegExp} imageRegex A regex to match the image src.
 */
function clickButtonWithImage(imageRegex) {
    const button = Array.from(document.querySelectorAll('[tabindex="0"]')).find(
        btn => Array.from(btn.querySelectorAll('img')).some(img => imageRegex.test(img.src)) && !btn.disabled
    );
    if (button) {
        clickElement(button);
    }
}

/**
 * In a given container, finds and clicks a button associated with a specific image.
 * @param {HTMLElement} container The parent element to search within.
 * @param {RegExp} imageRegex A regex to match the image src.
 */
function clickButtonInContainerWithImage(container, imageRegex) {
    const image = Array.from(container.querySelectorAll('img')).find(img => imageRegex.test(img.src));
    if (image) {
        const button = image.querySelector('[tabindex="0"]');
        if (button && !button.disabled) {
            clickElement(button);
        }
    }
}

/**
 * Finds and clicks the button that is most deeply nested in the DOM containing a specific image.
 * This helps differentiate between multiple buttons with the same image.
 * @param {string} imageSrcPart
 */
function clickMostNestedButtonWithImage(imageSrcPart) {
    const buttons = Array.from(document.querySelectorAll('[tabindex="0"]')).filter(
        btn => Array.from(btn.querySelectorAll('img')).some(img => img.src.includes(imageSrcPart)) && !btn.disabled
    );
    if (buttons.length === 0) return;

    let deepestButton = buttons[0];
    let maxDepth = 0;
    for (const button of buttons) {
        let depth = 0;
        let parent = button.parentElement;
        while (parent) {
            depth++;
            parent = parent.parentElement;
        }
        if (depth > maxDepth) {
            maxDepth = depth;
            deepestButton = button;
        }
    }
    clickElement(deepestButton);
}

/**
 * Clicks the button that is the shallowest (least nested) inside a given container.
 * @param {HTMLElement} container The parent element.
 */
function clickShallowestButtonInContainer(container) {
    const buttons = Array.from(container.querySelectorAll('[tabindex="0"]')).filter(btn => !btn.disabled);
    if (buttons.length === 0) return;

    let shallowestButton = buttons[0];
    let minDepth = Infinity;
    buttons.forEach(button => {
        let depth = 0;
        let parent = button.parentElement;
        while (parent && parent !== container) {
            depth++;
            parent = parent.parentElement;
        }
        if (depth < minDepth) {
            minDepth = depth;
            shallowestButton = button;
        }
    });
    clickElement(shallowestButton);
}

/**
 * Checks if an image with a specific src is present on the page.
 * @param {string} imageSrcPart
 * @returns {boolean}
 */
function isImagePresent(imageSrcPart) {
    return Array.from(document.querySelectorAll('img')).some(img => img.src.includes(imageSrcPart));
}

/**
 * Checks if a container element holds an image matching a regex.
 * @param {HTMLElement} container
 * @param {RegExp} imageRegex
 * @returns {boolean}
 */
function containerHasImage(container, imageRegex) {
    return Array.from(container.querySelectorAll('img')).some(img => imageRegex.test(img.src));
}

/**
 * Checks if the document body's text content includes a given string.
 * @param {string} text
 * @returns {boolean}
 */
function bodyContainsText(text) {
    return document.body.textContent.includes(text);
}

/**
 * Attempts to parse the game phase (e.g., "Voting", "Night") from the top of the screen.
 * @returns {string|null} The current game phase text.
 */
function getGamePhase() {
    const divs = document.querySelectorAll('div');
    for (let i = 0; i < divs.length; i++) {
        const text = divs[i].textContent;
        const match = text && text.match(/^([\S\s]*?)\s*\d{1,2}s$/); // Matches text followed by a timer like "Voting 30s"
        if (match) {
            return match[1].trim();
        }
    }
    return null;
}

/**
 * Determines if the current phase is a day/voting phase.
 * @returns {boolean}
 */
function isDayPhase() {
    const phase = getGamePhase();
    return phase === 'Choose a player to vote for' || phase === 'Voting';
}

/**
 * Determines if the current phase is a night phase.
 * @returns {boolean}
 */
function isNightPhase() {
    return getGamePhase() === ''; // The night phase often has an empty phase string
}

/**
 * Determines if the game has ended or is on a summary screen.
 * @returns {boolean}
 */
function isGameFinished() {
    return (
        bodyContainsText('Continue') ||
        bodyContainsText('Play again') ||
        bodyContainsText('Victory') ||
        bodyContainsText('Defeat') ||
        bodyContainsText('Draw')
    );
}

/**
 * Normalizes a role name from its image filename.
 * @param {string} roleFileName e.g., "junior_werewolf.png"
 * @returns {string} e.g., "Junior Werewolf"
 */
function normalizeRoleName(roleFileName) {
    if (!roleFileName) return 'Unknown';
    let role = 'Villager';
    const roleMap = {
        'juniorwerewolf': 'Junior Werewolf',
        'junior_werewolf': 'Junior Werewolf',
        'split_wolf': 'Split Wolf',
        'splitwolf': 'Split Wolf',
        'wolf': 'Wolf',
        'priest': 'Priest',
        'vigilante': 'Shooter',
        'gunner': 'Shooter',
    };
    for (const key of Object.keys(roleMap)) {
        if (roleFileName.includes(key)) {
            role = roleMap[key];
            break;
        }
    }
    return role;
}

// ===================================================================================
 // CORE BOT LOGIC
 // ===================================================================================

/**
 * Handles day phase actions like voting and using special abilities (Priest, Shooter).
 * @param {object} playerInfo - Information about the current player and their couple.
 * @param {HTMLElement[]} coupleElements - The DOM elements for the coupled players.
 * @param {HTMLElement[][]} playerImageElements - A nested array of image elements for each player.
 * @param {HTMLElement[]} allPlayerElements - A list of all player container elements.
 */
async function handleDayPhaseActions(playerInfo, coupleElements, playerImageElements, allPlayerElements) {
    if (isGameFinished()) return;

    // If player is not a wolf and their couple partner isn't either
    if (!WOLF_ROLES.has(playerInfo.coupleRole1) && !WOLF_ROLES.has(playerInfo.coupleRole2)) {
        // If the player is a wolf role (but not in the couple), they might signal who to vote for.
        if (WOLF_ROLES.has(playerInfo.role)) {
            // Logic to type the couple's number in chat
            // (This part seems to be missing full implementation in the original)
        } else {
            // Logic for non-wolf roles like Priest and Shooter to use their ability during the day.
            const ability = {
                'Priest': { triggerRegex: /.*priest_holy_water.*\.png/, actionRegex: /.*priest_holy_water.*\.png/ },
                'Shooter': { triggerRegex: /.*gunner_bullet.*\.png/, actionRegex: /.*gunner_voting_shoot.*\.png/ },
            };
            const playerAbility = ability[playerInfo.role];
            if (!playerAbility) return;

            await findElementByImageSrc('vote_day', { timeout: 90000, cancelText: 'Continue' });
            if (isGameFinished()) return;

            clickButtonWithImage(playerAbility.triggerRegex);
            await sleep(200);

            // Find the player who is currently selected for voting
            const selectedPlayer = allPlayerElements.find(p => containerHasImage(p, /.*vote_day_selected.*\.png/));
            if (selectedPlayer) {
                clickButtonInContainerWithImage(selectedPlayer, playerAbility.actionRegex);
            }
        }
    } else {
        // If one or both players in the couple are wolves, vote for the non-wolf partner.
        const hasVoted = playerImageElements.some(p => p.some(img => img.includes('hand-skin')));
        if (!hasVoted) {
            const targetElement = WOLF_ROLES.has(playerInfo.coupleRole1) ? coupleElements[0] : coupleElements[1];
            clickShallowestButtonInContainer(targetElement);
        }
        // Additional logic for priest/shooter if they are the player
    }
}

/**
 * Handles night phase actions like wolf communication and role-specific choices.
 * @param {object} playerInfo
 * @param {HTMLElement[]} coupleElements
 * @param {HTMLElement[]} allPlayerElements
 */
async function handleNightPhaseActions(playerInfo, coupleElements, allPlayerElements) {
    if (isGameFinished()) return;

    // Helper to type in chat and optionally vote
    const typeAndVote = (message, voteTargetElement) => {
        if (isGameFinished()) return;
        const chatInput = document.querySelector('textarea.chat-input');
        // This simulates typing into the textarea
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(chatInput, message);
        chatInput.dispatchEvent(new Event('input', { 'bubbles': true }));
        chatInput.dispatchEvent(new Event('change', { 'bubbles': true }));

        clickButtonWithImage(/.*icon_send.*\.png/);

        // If a vote target is provided and specific conditions are met, cast a vote.
        if (voteTargetElement && (playerInfo.coupleRole1 !== 'Priest' && playerInfo.coupleRole2 !== 'Priest' || playerInfo.role === 'Junior Werewolf')) {
            clickShallowestButtonInContainer(voteTargetElement);
        }
    };

    // Logic for different wolf roles at night
    if (playerInfo.role === 'Wolf') {
        await findElementByText('Choose a player to kill', { cancelText: 'Continue' });
        if (isGameFinished() || bodyContainsText('Voting')) return;

        const coupleRole1 = playerInfo.coupleRole1;
        const coupleRole2 = playerInfo.coupleRole2;
        if ((WOLF_ROLES.has(coupleRole1) && WOLF_ROLES.has(coupleRole2)) || (WOLF_ROLES.has(coupleRole1) && coupleRole2 === null)) {
            return; // Don't act if both are wolves or only one player is in couple and is a wolf.
        }

        const isCouplePriest = coupleRole1 === 'Priest' || coupleRole2 === 'Priest';
        const isPlayerWolfInCouple = !WOLF_ROLES.has(playerInfo.coupleRole1);
        const targetPlayerNumber = isPlayerWolfInCouple ? playerInfo.coupleNumber1 : playerInfo.coupleNumber2;
        const targetPlayerElement = isPlayerWolfInCouple ? coupleElements[0] : coupleElements[1];

        typeAndVote(isCouplePriest ? `${targetPlayerNumber} priest` : targetPlayerNumber, targetPlayerElement);
        
        // Wait for voting phase to end
        await findElementByText('Voting', { cancelText: 'Continue' });

    } else if (playerInfo.role === 'Junior Werewolf' || playerInfo.role === 'Split Wolf') {
        // Logic for Junior/Split wolf to signal their target to the other wolves
        const actionImageRegex = playerInfo.role === 'Junior Werewolf' ?
            /.*junior_werewolf_selection_marker.*\.png/ :
            /.*splitwolf_bind.*\.png/;
        
        if ((WOLF_ROLES.has(playerInfo.coupleRole1) && WOLF_ROLES.has(playerInfo.coupleRole2)) || (WOLF_ROLES.has(playerInfo.coupleRole1) && playerInfo.coupleRole2 === null)) {
            return;
        }

        await findElementByText('Choose a player to kill', { cancelText: 'Continue' });
        if (isGameFinished() || bodyContainsText('Voting')) return;
        
        const isPlayerWolfInCouple = !WOLF_ROLES.has(playerInfo.coupleRole1);
        const targetPlayerNumber = isPlayerWolfInCouple ? playerInfo.coupleNumber1 : playerInfo.coupleNumber2;
        const targetPlayerElement = isPlayerWolfInCouple ? coupleElements[0] : coupleElements[1];
        
        typeAndVote(`-> ${targetPlayerNumber}`, targetPlayerElement);
    }
}

/**
 * The main information gathering function. It inspects the DOM to figure out
 * player names, roles, numbers, and couple information.
 * @param {string} currentUserName - The name of the user running the script.
 */
async function gatherPlayerInfo(currentUserName) {
    // Find all player containers that are alive
    const allPlayerElements = Array.from(document.querySelectorAll('.player-list-entry.alive'));

    // Filter to find players who are part of a couple (indicated by a heart icon)
    const couplePlayerElements = allPlayerElements.filter(el =>
        Array.from(el.querySelectorAll('img')).some(img => img.src.includes('icon_couple.png'))
    );

    // The user's own player element does not have the couple icon, so add them if they are in a couple.
    const selfInCouple = couplePlayerElements.filter(el => !el.textContent.includes(currentUserName));
    while (selfInCouple.length < 2) selfInCouple.push(null); // Ensure array has 2 elements

    // Extract image sources for all players to determine roles
    const getImagesForPlayers = (elements) => elements.map(el =>
        Array.from(el.querySelectorAll('img')).map(img => {
            const parts = img.src.split('/');
            return parts[parts.length - 1]; // Get filename like "wolf.png"
        })
    );

    const coupleImages = getImagesForPlayers(selfInCouple);
    const allPlayerImages = getImagesForPlayers(allPlayerElements);

    const getRoleFromImages = (imageArray) => imageArray.map(images => {
        let roleImage = images.find(img => !img.includes('vote_day') && !img.includes('icon_couple') && !img.includes('icon_dead'));
        return roleImage;
    });

    const selfRoleImages = getRoleFromImages(allPlayerImages.filter((_, i) => allPlayerElements[i].textContent.includes(currentUserName)));
    const coupleRoleImages = getRoleFromImages(coupleImages);
    
    const selfElement = allPlayerElements.find(el => el.textContent.includes(currentUserName));
    const getPlayerNumber = (el) => el ? (el.textContent.match(/\d+/)?.[0] || null) : null;

    const playerInfo = {
        name: currentUserName,
        number: getPlayerNumber(selfElement),
        role: normalizeRoleName(selfRoleImages[0]),
        coupleNumber1: getPlayerNumber(selfInCouple[0]),
        coupleRole1: normalizeRoleName(coupleRoleImages[0]),
        coupleNumber2: getPlayerNumber(selfInCouple[1]),
        coupleRole2: normalizeRoleName(coupleRoleImages[1]),
    };

    // Based on game phase, trigger the appropriate action handler
    if (isDayPhase()) {
        await handleDayPhaseActions(playerInfo, selfInCouple, allPlayerImages, allPlayerElements);
    } else if (isNightPhase()) {
        await handleNightPhaseActions(playerInfo, selfInCouple, allPlayerElements);
    }
}

/**
 * Handles the screens after a game ends (Victory/Defeat), clicking through
 * to start a new game.
 */
async function handlePostGame() {
    if (bodyContainsText('Searching for players')) return;

    // Click "Continue" button
    const continueButton = Array.from(document.querySelectorAll('[tabindex="0"]')).find(
        el => el.textContent.includes('Continue') && isElementVisible(el) && el.getBoundingClientRect().top > 100
    );
    if (continueButton) clickElement(continueButton);

    // Click "Play again" button
    await findElementByText('Play again', { cancelText: 'START GAME' });
    const playAgainButton = Array.from(document.querySelectorAll('[tabindex="0"]')).find(
        el => el.textContent.includes('Play again') && isElementVisible(el) && el.getBoundingClientRect().top > 100
    );
    if (playAgainButton) clickElement(playAgainButton);

    await sleep(300);

    // Click "OK" on confirmation dialogs
    const okButton = Array.from(document.querySelectorAll('[tabindex="0"]')).find(
        el => {
            if (!el.textContent.includes('OK') || !isElementVisible(el) || el.getBoundingClientRect().top <= 100) return false;
            // Make sure there is a "Cancel" button nearby to ensure it's a dialog
            const hasCancelSibling = Array.from(el.parentElement?.querySelectorAll('[tabindex="0"]') || []).some(
                sib => sib !== el && sib.textContent.includes('Cancel') && isElementVisible(sib)
            );
            return hasCancelSibling;
        }
    );
    if (okButton) clickElement(okButton);
}

/**
 * The main game loop/state machine. It checks the current game state and
 * calls the appropriate function to handle it.
 * @param {string} userName
 */
async function mainGameLogic(userName) {
    let bodyText = document.body.textContent;
    const bodyContains = text => bodyText.includes(text);

    if (bodyContains('START GAME') || bodyContains('Leave game')) {
        const startButton = Array.from(document.querySelectorAll('[tabindex="0"]')).find(
            el => el.textContent.includes('START GAME') && isElementVisible(el) && el.getBoundingClientRect().top > 100
        );
        if (startButton) clickElement(startButton);
    }

    if (bodyContains('Team: You belong to')) {
        if (isImagePresent('icon_win_screenshot.png')) {
            clickMostNestedButtonWithImage('icon_close.png');
        }
    }

    if (bodyContains('Continue')) {
        return await handlePostGame();
    }

    if ((bodyContains('Night') || bodyContains('Voting')) && !isGameFinished()) {
        await gatherPlayerInfo(userName);
    }
}

/**
 * Sends a log of the user and script version to the backend.
 * @param {string} userName
 */
function logUser(userName) {
    const scriptVersion = '1.0.0'; // Or dynamically get version
    fetch('https://abstract-wov.glitch.me/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: userName, version: scriptVersion }),
    }).then(() => {});
}

/**
 * Verifies the user's name and subscription status against the backend server.
 * @param {string} userName
 * @returns {Promise<object>}
 */
async function verifyUser(userName) {
    try {
        const response = await fetch('https://abstract-wov.glitch.me/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: userName }),
        });
        if (!response.ok) {
            throw new Error('Network response not OK');
        }
        const data = await response.json();
        return data;
    } catch (error) {
        throw new Error('Failed to verify name: ' + error.message);
    }
}

// ===================================================================================
// INITIALIZATION AND MAIN LOOP
// ===================================================================================

(async () => {
    // Removed verification process. The bot will now run without authentication.
    let userName = "unverified_user";  // Default username, can be changed or removed.
    alert('Λbstract is running (Unverified).\nNo expiry.');

    async function automationLoop() {
        try {
            await mainGameLogic(userName);
        } catch (error) {
            console.error("Error in automation loop:", error);
        } finally {
            await sleep(1000);
            automationLoop();
        }
    }
    automationLoop();
})();

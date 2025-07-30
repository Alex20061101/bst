/*
 * This file is the core content script for the "Λbstract" extension.
 * It contains the automation logic (the "bot") for playing wolvesville.com.
 */

const CLIENT_VERSION = '1.6';
const WOLF_ROLES = new Set(['Wolf', 'Junior Werewolf', 'Split Wolf']);
const DEBUG = true; // Set to true for verbose logging in the console
const GameState = {
    UNKNOWN: 'UNKNOWN',
    LOBBY: 'LOBBY',
    ROLE_SELECTION: 'ROLE_SELECTION',
    IN_GAME: 'IN_GAME',
    POST_GAME: 'POST_GAME',
    CUSTOM: 'CUSTOM',
    HOME_SCREEN: 'HOME_SCREEN',
    GAME_SCREEN: 'GAME_SCREEN'
};

/**
 * A conditional logger that only prints to the console if DEBUG is true.
 * @param  {...any} args Arguments to pass to console.log
 */
function log(...args) {
    if (DEBUG) {
        console.log('[Λbstract]', ...args);
    }
}

// --- Visual Debugger for Clicks ---
let clickDebugger = null;

// --- Core Helper & Utility Functions ---

/**
 * Sends a message to the background script to perform a click at the element's center.
 * @param {HTMLElement} element The element to click.
 * @param {string} [button='left'] The mouse button to simulate.
 */
async function click(element, button = 'left') {
    const rect = element.getBoundingClientRect();
    // Check if the element is off-screen or has no size
    if (rect.width === 0 || rect.height === 0) {
        log(`Click skipped: Element has no dimensions or is not on screen.`, element);
        return;
    }
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    // Show a visual indicator at the click location for debugging.
    showClickAt(x, y);

    log(`Request click @ ${x}, ${y} → ${element.textContent.trim()}`);
    
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'performClick', x, y, button }, response => {
            if (chrome.runtime.lastError) {
                console.error(`[Λbstract] sendMessage error: ${chrome.runtime.lastError.message}`);
                return reject(new Error(chrome.runtime.lastError.message));
            }
            if (response && response.ok) {
                log('BG responded:', response);
                resolve(response);
            } else {
                log('BG responded with an error:', response);
                reject(new Error(response?.error || 'Unknown error during click'));
            }
        });
    });
}

/**
 * Creates a visual element on the page to show where clicks are happening.
 * This is a debugging tool and is only active when DEBUG is true.
 * @returns {HTMLElement} The debugger element.
 */
function createClickDebugger() {
    const el = document.createElement('div');
    el.id = '__click_debugger';
    Object.assign(el.style, {
        position: 'fixed',
        width: '10px',
        height: '10px',
        backgroundColor: 'red',
        borderRadius: '50%',
        zIndex: '99999',
        pointerEvents: 'none',
        opacity: '0.8',
        transition: 'opacity 0.5s ease-out',
        display: 'none'
    });
    document.body.appendChild(el);
    return el;
}

/**
 * Displays the click debugger at the specified coordinates.
 * @param {number} x The x-coordinate of the click.
 * @param {number} y The y-coordinate of the click.
 */
function showClickAt(x, y) {
    if (!DEBUG) return;
    if (!clickDebugger) clickDebugger = createClickDebugger();
    
    clickDebugger.style.left = `${x - 5}px`; // Center the dot
    clickDebugger.style.top = `${y - 5}px`;
    clickDebugger.style.display = 'block';
    setTimeout(() => { if (clickDebugger) clickDebugger.style.display = 'none'; }, 500);
}

/**
 * Checks if an element is currently visible on the page.
 * @param {HTMLElement} element The element to check.
 * @returns {boolean} True if the element is visible.
 */
function isVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    return (
        element.offsetParent !== null &&
        element.offsetWidth > 0 &&
        element.offsetHeight > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        element.getClientRects().length > 0
    );
}

/**
 * A simple promise-based sleep function.
 * @param {number} ms Milliseconds to wait.
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- DOM Waiting Functions ---

/**
 * Generic function to wait for a condition to be met before proceeding.
 * @param {() => any} conditionFn Function that returns a truthy value when the condition is met.
 * @param {number} timeout Time in ms to wait before giving up.
 * @param {number} interval Time in ms between checks.
 * @param {string | string[] | null} cancelConditions If this text (or any of these texts) appears in the DOM, the wait is cancelled.
 * @returns {Promise<any | null>} The result of the condition function or null if timed out/cancelled.
 */
function waitForCondition(conditionFn, timeout, interval, cancelConditions) {
    const cancelTexts = cancelConditions ? (Array.isArray(cancelConditions) ? cancelConditions : [cancelConditions]) : [];
    return new Promise(resolve => {
        const startTime = Date.now();
        const check = () => {
            const result = conditionFn();
            if (result) {
                return resolve(result);
            }
            if (cancelTexts.length > 0) {
                const pageText = document.body.innerText;
                const foundCancelText = cancelTexts.find(text => pageText.includes(text));
                if (foundCancelText) {
                    log(`waitForCondition cancelled by: "${foundCancelText}"`);
                    return resolve(null);
                }
            }
            if (Date.now() - startTime >= timeout) {
                return resolve(null);
            }
            setTimeout(check, interval);
        };
        check();
    });
}

/**
 * Waits for an element containing specific text to appear in the DOM.
 * @param {string} text The text to search for.
 * @param {{timeout?: number, interval?: number, cancelText?: string}} options
 * @returns {Promise<HTMLElement | null>}
 */
function waitForTextInDOM(text, { timeout = 30000, interval = 200, cancelText = null } = {}) {
    return waitForCondition(() => {
        for (const el of document.body.querySelectorAll('*')) {
            if (el.textContent.includes(text) && isVisible(el)) {
                return el;
            }
        }
    }, timeout, interval, cancelText);
}

/**
 * Waits for an element with an exact text match to appear in the DOM.
 * @param {string} text The exact text to match.
 * @param {{timeout?: number, interval?: number, cancelText?: string}} options
 * @returns {Promise<HTMLElement | null>}
 */
function waitForExactText(text, { timeout = 30000, interval = 200, cancelText = null } = {}) {
    const textRegex = new RegExp(`\\b${text}\\b`);
    return waitForCondition(() => {
        for (const el of document.body.querySelectorAll('*')) {
            if (textRegex.test(el.textContent) && isVisible(el)) {
                return el;
            }
        }
    }, timeout, interval, cancelText);
}

/**
 * Waits for an image with a specific src to appear in the DOM.
 * @param {string} imageNamePart Part of the image src to search for.
 * @param {{timeout?: number, interval?: number, cancelText?: string}} options
 * @returns {Promise<HTMLImageElement | null>}
 */
function waitForImageInDOM(imageNamePart, { timeout = 30000, interval = 200, cancelText = null } = {}) {
    return waitForCondition(() => {
        for (const img of document.images) {
            if (img.src.includes(imageNamePart) && isVisible(img)) {
                return img;
            }
        }
    }, timeout, interval, cancelText);
}

/**
 * Waits for a specific number of images matching a criteria to appear.
 * @param {string} imageNamePart Part of the image src to search for.
 * @param {number} [count=2] The number of images to wait for.
 * @param {{timeout?: number, interval?: number, cancelText?: string}} options
 * @returns {Promise<HTMLImageElement[] | null>}
 */
function waitForImageCountInDOM(imageNamePart, count = 2, { timeout = 30000, interval = 200, cancelText = null } = {}) {
    return waitForCondition(() => {
        const foundImages = [];
        for (const img of document.images) {
            if (img.src.includes(imageNamePart) && isVisible(img)) {
                foundImages.push(img);
            }
            if (foundImages.length >= count) {
                return foundImages;
            }
        }
    }, timeout, interval, cancelText);
}

// --- DOM Interaction Helpers ---

/**
 * Clicks an element and retries if a verification element does not disappear.
 * @param {string} verifyDisappearText Text that should disappear after the click.
 * @param {() => HTMLElement} findElementFn Function that returns the element to click.
 * @param {number} [retries=3] Number of times to retry.
 */
async function clickAndVerifyDisappear(verifyDisappearText, findElementFn, retries = 3) {
    for (let i = 0; i < retries; i++) {
        // If the text is already gone, we don't need to do anything.
        if (!findTextInDocument(verifyDisappearText)) return;

        const elementToClick = findElementFn();
        if (!elementToClick) {
            // Can't find the button, wait a moment in case it's slow to appear.
            await sleep(200);
            continue;
        }

        click(elementToClick);

        // Actively wait for the text to disappear instead of a fixed sleep. This is much faster.
        const disappeared = await waitForCondition(() => !findTextInDocument(verifyDisappearText), 1500, 50);
        
        if (disappeared) return; // Success, exit the function.
    }
}

/**
 * Finds the first clickable parent of an image matching a regex.
 * @param {RegExp} imageRegex Regex to match the image src.
 */
function clickElementByImage(imageRegex) {
    const clickableElement = Array.from(document.querySelectorAll('[tabindex="0"]'))
        .find(el => Array.from(el.querySelectorAll('img')).some(img => imageRegex.test(img.src)) && !el.disabled);
    if (clickableElement) {
        click(clickableElement);
    }
}

/**
 * Finds an image within a container and clicks its clickable parent.
 * @param {HTMLElement} container The element to search within.
 * @param {RegExp} imageRegex Regex to match the image src.
 */
function clickElementByImageInElement(container, imageRegex) {
    const imgElement = Array.from(container.querySelectorAll('img')).find(img => imageRegex.test(img.src));
    if (imgElement) {
        const clickableParent = imgElement.closest('[tabindex="0"]');
        if (clickableParent && !clickableParent.disabled) {
            click(clickableParent);
        }
    }
}

/**
 * Finds the most deeply nested clickable element containing an image.
 * @param {string} imageNamePart Part of the image src to search for.
 */
function clickInnermostElementByImage(imageNamePart) {
    const candidates = Array.from(document.querySelectorAll('[tabindex="0"]'))
        .filter(el => Array.from(el.querySelectorAll('img')).some(img => img.src.includes(imageNamePart)) && !el.disabled);

    if (candidates.length === 0) return;

    let deepestElement = candidates[0];
    let maxDepth = 0;

    for (const el of candidates) {
        let depth = 0;
        let parent = el.parentElement;
        while (parent) {
            depth++;
            parent = parent.parentElement;
        }
        if (depth > maxDepth) {
            maxDepth = depth;
            deepestElement = el;
        }
    }
    click(deepestElement);
}

/**
 * Finds the most deeply nested clickable element containing specific text.
 * @param {string} text The text to search for.
 */
function clickInnermostElementByText(text) {
    const candidates = Array.from(document.querySelectorAll('[tabindex="0"]'))
        .filter(el => el.textContent.includes(text) && !el.disabled);

    if (candidates.length === 0) return;

    let deepestElement = candidates[0];
    let maxDepth = 0;

    candidates.forEach(el => {
        let depth = 0;
        let parent = el.parentElement;
        while (parent) {
            depth++;
            parent = parent.parentElement;
        }
        if (depth > maxDepth) {
            maxDepth = depth;
            deepestElement = el;
        }
    });
    click(deepestElement);
}

/**
 * Clicks the highest-level (least nested) clickable element within a container.
 * @param {HTMLElement} container The element to search within.
 */
function clickOutermostElement(container) {
    const candidates = Array.from(container.querySelectorAll('[tabindex="0"]')).filter(el => !el.disabled);
    if (candidates.length === 0) return;

    let outermostElement = candidates[0];
    let minDepth = Infinity;

    candidates.forEach(el => {
        let depth = 0;
        let parent = el.parentElement;
        while (parent && parent !== container) {
            depth++;
            parent = parent.parentElement;
        }
        if (depth < minDepth) {
            minDepth = depth;
            outermostElement = el;
        }
    });
    click(outermostElement);
}

/**
 * Finds the most deeply nested, visible, and enabled clickable element containing specific text.
 * This is useful for buttons that might not be standard elements but have a role or tabindex.
 * @param {string} text The text to search for.
 * @returns {HTMLElement | null} The found element or null.
 * @param {object} [options]
 * @param {string | null} [options.exclude=null] Text to exclude from the element's content.
 */
function findDeepestClickableElementByText(text, { exclude = null } = {}) {
    const selector = '[tabindex="0"], button, [role="button"]';
    const candidates = Array.from(document.querySelectorAll(selector))
        .filter(el => isVisible(el) && !el.disabled && el.textContent.includes(text) && !(exclude && el.textContent.includes(exclude)));
        
    if (candidates.length === 0) {
        return null;
    }

    if (candidates.length === 1) {
        return candidates[0];
    }

    // Find the most deeply nested element to avoid clicking a container that also contains the text.
    return candidates.reduce((deepest, current) => {
        const getDepth = (e) => { let d = 0; while (e.parentElement) { d++; e = e.parentElement; } return d; };
        return getDepth(current) > getDepth(deepest) ? current : deepest;
    });
}

// --- Game State Parsing Functions ---

/**
 * Checks if an image with a given name exists anywhere in the document.
 * @param {string} imageNamePart
 * @returns {boolean}
 */
function findImageInDocument(imageNamePart) {
    return Array.from(document.querySelectorAll('img')).some(img => img.src.includes(imageNamePart));
}

/**
 * Checks if an image matching a regex exists within a given element.
 * @param {HTMLElement} element
 * @param {RegExp} imageRegex
 * @returns {boolean}
 */
function findImageInElement(element, imageRegex) {
    return Array.from(element.querySelectorAll('img')).some(img => imageRegex.test(img.src));
}

/**
 * Checks if certain text exists anywhere in the document body.
 * @param {string} text
 * @returns {boolean}
 */
function findTextInDocument(text) {
    return document.body.textContent.includes(text);
}

/**
 * Extracts messages from the game's chatbox.
 * @returns {string[] | null} An array of messages or null.
 */
function getMessages() {
    // This function seems to have a complex heuristic to find the main chat panel.
    // It finds all spans, identifies the ones that look like a username (contain ':'),
    // and then finds the chat panel with the minimum width to filter out other panels.
    const messages = [];
    let minWidth = Infinity;
    const messageElements = [];

    document.querySelectorAll('span').forEach(span => {
        if (span.textContent.includes(':')) {
            const containerDiv = span.closest('div');
            if (containerDiv) {
                const rect = containerDiv.getBoundingClientRect();
                const containerSize = rect.width * rect.height;
                if (containerSize < minWidth) {
                    minWidth = containerSize;
                    messageElements.length = 0; // Clear previous smaller ones
                    messageElements.push({ div: containerDiv, spanText: span.textContent });
                } else if (containerSize === minWidth) {
                    messageElements.push({ div: containerDiv, spanText: span.textContent });
                }
            }
        }
    });

    if (messageElements.length > 0) {
        return messageElements.map(({ div, spanText }) => div.textContent.replace(spanText, '').trim());
    }
    return null;
}

/**
 * Determines a player's role from the image filename.
 * @param {string} roleImageFilename The filename of the role icon (e.g., "junior_werewolf.png").
 * @returns {string} The normalized role name.
 */
function getPlayerRole(roleImageFilename) {
    if (!roleImageFilename) return 'Unknown';
    let role = 'Other';
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
        if (roleImageFilename.includes(key)) {
            role = roleMap[key];
            break;
        }
    }
    return role;
}

/**
 * Extracts the current game phase label (e.g., "Discussion", "Voting").
 * @returns {string | null}
 */
function getLabelBeforeTime() {
    const timerElements = document.querySelectorAll('div');
    for (let i = 0; i < timerElements.length; i++) {
        const text = timerElements[i].textContent;
        const match = text && text.match(/^([\S\s]*?)\s*\d{1,2}s$/);
        if (match) {
            return match[1].trim();
        }
    }
    return null;
}

/** @returns {boolean} True if the game is in the day phase. */
function isDay() {
    const label = getLabelBeforeTime();
    return label === 'Discussion' || label === 'Voting';
}

/** @returns {boolean} True if the game is in the night phase. */
function isNight() {
    return getLabelBeforeTime() === '';
}

/** @returns {boolean} True if a game over screen is detected. */
function gameIsOver() {
    return findTextInDocument('Continue') ||
        findTextInDocument('Play again') ||
        findTextInDocument('Victory') ||
        findTextInDocument('Defeat') ||
        findTextInDocument('Draw');
}


// --- Game Logic Functions ---

/**
 * Handles the logic for the "Shooter" role during the day.
 * @param {object} playerInfo
 * @param {HTMLElement[]} coupleElements
 * @param {HTMLElement[]} allPlayerElements
 * @param {number} [voteMarkersToFind=2]
 */
async function shooterAction(playerInfo, coupleElements, allPlayerElements, voteMarkersToFind = 2) {
    log(`shooterAction: looking for ${voteMarkersToFind} vote marker(s)`);
    const VOTE_MARKER_IMG = 'vote_day_selected';
    if (voteMarkersToFind > 4) return;

    await waitForImageCountInDOM(VOTE_MARKER_IMG, voteMarkersToFind, { timeout: 90000, cancelText: 'Continue' });
    if (gameIsOver()) return;

    log('Clicking bullet icon...');
    clickElementByImage(/.*gunner_bullet.*\.png/);
    await sleep(200);

    // Find a player who is voted for, is not a lover, and is not self
    const target = allPlayerElements.find(el =>
        findImageInElement(el, new RegExp(`.*${VOTE_MARKER_IMG}.*\\.png`)) &&
        !coupleElements.includes(el) &&
        !el.textContent.includes(playerInfo.name)
    );

    if (target) {
        log('Shooter found target:', target?.textContent.trim());
        clickElementByImageInElement(target, /.*gunner_voting_shoot.*\.png/);
        return;
    }

    // If no target found, wait and try again with more vote markers
    await sleep(500);
    await shooterAction(playerInfo, coupleElements, allPlayerElements, voteMarkersToFind + 1);
}


/**
 * Contains the main logic for actions taken during the day.
 * @param {object} playerInfo
 * @param {HTMLElement[]} coupleElements
 * @param {HTMLElement[][]} playerImages
 * @param {HTMLElement[]} allPlayerElements
 */
async function inGameDay(playerInfo, coupleElements, playerImages, allPlayerElements) {
    if (gameIsOver()) return;

    log(`inGameDay(): role = ${playerInfo.role} | Lovers = ${coupleElements.map(c => c?.textContent.trim())}`);

    const isWolfCoupled = WOLF_ROLES.has(playerInfo.coupleRole1) || WOLF_ROLES.has(playerInfo.coupleRole2);

    if (!isWolfCoupled) {
        // Logic for when not coupled with a wolf
        if (WOLF_ROLES.has(playerInfo.role)) {
            // I am a wolf, not coupled with a wolf. Maybe send a message.
            const messages = getMessages();
            const mentionedNumbers = messages?.flatMap(msg => msg.match(/\b\d{1,2}\b/g) || []);
            if (mentionedNumbers?.some(num => num == playerInfo.number)) {
                return; // My number was mentioned, do nothing.
            }

            if (gameIsOver()) return;
            log('Wolf sending number:', playerInfo.number);
            const chatInput = document.querySelector('textarea');
            const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
            valueSetter.call(chatInput, playerInfo.number);
            chatInput.dispatchEvent(new Event('input', { bubbles: true }));
            chatInput.dispatchEvent(new Event('change', { bubbles: true }));
            clickElementByImage(/.*icon_send.*\.png/);
            await sleep(500);
        } else {
            // I am a villager, not coupled with a wolf. Use special abilities.
            const abilities = {
                'Priest': { triggerRegex: /.*priest_holy_water.*\.png/, actionRegex: /.*priest_holy_water.*\.png/ },
                'Shooter': { triggerRegex: /.*gunner_bullet.*\.png/, actionRegex: /.*gunner_voting_shoot.*\.png/ }
            };
            const ability = abilities[playerInfo.role];
            if (!ability) return;

            await waitForImageInDOM('vote_day_selected', { timeout: 90000, cancelText: 'Continue' });
            if (gameIsOver()) return;

            log('Role ability triggered:', playerInfo.role);
            clickElementByImage(ability.triggerRegex);
            await sleep(200);

            const votedPlayer = allPlayerElements.find(p => findImageInElement(p, /.*vote_day_selected.*\.png/));
            if (votedPlayer) {
                clickElementByImageInElement(votedPlayer, ability.actionRegex);
            }
        }
    } else {
        // Logic for when I or my partner is a wolf (or I'm coupled with one)
        const alreadyVotedForCouple = playerImages.some(imgSet => imgSet.some(img => img.includes('cupid')));
        if (!alreadyVotedForCouple) {
            const targetLover = WOLF_ROLES.has(playerInfo.coupleRole1) ? coupleElements[0] : coupleElements[1];
            log('Voting couple:', targetLover.textContent.trim());
            clickOutermostElement(targetLover);
        }

        if (playerInfo.role === 'Priest') {
            log('Role ability triggered:', playerInfo.role);
            clickElementByImage(/.*priest_holy_water.*\.png/);
            setTimeout(() => {
                const votedPlayer = allPlayerElements.find(p => findImageInElement(p, /.*priest_holy_water.*\.png/));
                if (votedPlayer) {
                    clickElementByImageInElement(votedPlayer, /.*priest_holy_water.*\.png/);
                }
            }, 200);
        } else if (playerInfo.role === 'Shooter') {
            await shooterAction(playerInfo, coupleElements, allPlayerElements);
        }
    }
}

/**
 * Contains the main logic for actions taken during the night.
 * @param {object} playerInfo
 * @param {HTMLElement[]} coupleElements
 * @param {HTMLElement[]} allPlayerElements
 */
async function inGameNight(playerInfo, coupleElements, allPlayerElements) {
    if (gameIsOver()) return;
    log(`inGameNight(): role = ${playerInfo.role}`);

    // --- Night Helper Functions ---
    const sendMessageAndAct = async (message, targetElement) => {
        if (gameIsOver()) return;
        log(`sendAction: ${message} | Target: ${targetElement?.textContent.trim()}`);
        const chatInput = document.querySelector('textarea');
        const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        valueSetter.call(chatInput, message);
        chatInput.dispatchEvent(new Event('input', { bubbles: true }));
        chatInput.dispatchEvent(new Event('change', { bubbles: true }));
        clickElementByImage(/.*icon_send.*\.png/);
        await sleep(500);

        if (targetElement) {
            const isNotPriestCoupled = playerInfo.coupleRole1 !== 'Priest' && playerInfo.coupleRole2 !== 'Priest';
            if (isNotPriestCoupled || playerInfo.role === 'Junior Werewolf') {
                clickOutermostElement(targetElement);
            }
        }
    };

    const handleWolfTagging = async (selectionMarkerRegex) => {
        const areBothPartnersWolves = WOLF_ROLES.has(playerInfo.coupleRole1) && WOLF_ROLES.has(playerInfo.coupleRole2);
        const isSoloWolfCoupled = WOLF_ROLES.has(playerInfo.coupleRole1) && playerInfo.coupleRole2 === null;
        if (areBothPartnersWolves || isSoloWolfCoupled) return;
        if (gameIsOver()) return;

        log('handleWolfTag() triggered for:', playerInfo.role);
        await waitForTextInDOM('25s', { cancelText: 'Continue' });
        if (gameIsOver() || findTextInDocument('Voting')) return;

        const isPartnerAWolf = !WOLF_ROLES.has(playerInfo.coupleRole1);
        const message = `Who? Mine ${isPartnerAWolf ? playerInfo.coupleNumber1 : playerInfo.coupleNumber2}`;
        const targetElement = isPartnerAWolf ? coupleElements[0] : coupleElements[1];
        sendMessageAndAct(message, targetElement);

        await waitForExactText('5s', { cancelText: 'Continue' });
        if (gameIsOver() || findTextInDocument('Voting')) return;

        clickElementByImage(selectionMarkerRegex);

        setTimeout(() => {
            const chatMessages = getMessages();
            const nonLoverNumbers = [playerInfo.number, playerInfo.coupleNumber1, playerInfo.coupleNumber2];
            const taggedNumber = chatMessages
                ?.flatMap(msg => (msg.match(/\b\d{1,2}\b/g) || []))
                .filter(num => !nonLoverNumbers.includes(num))[0];

            if (!taggedNumber) return;
            log('Target number chosen:', taggedNumber);
            const targetPlayerElement = allPlayerElements[parseInt(taggedNumber, 10) - 1];
            const targetImage = [...targetPlayerElement.querySelectorAll('img')].find(img => selectionMarkerRegex.test(img.src));
            const clickableButton = targetImage?.closest('[tabindex="0"]:not([disabled])');

            if (clickableButton) {
                click(clickableButton);
            }
        }, 200);

        await waitForTextInDOM('Voting', { cancelText: 'Continue' });
    };

    // --- Main Night Logic ---

    if (playerInfo.role === 'Wolf') {
        await waitForTextInDOM('25s', { cancelText: 'Continue' });
        if (gameIsOver() || findTextInDocument('Voting')) return;

        const { coupleRole1, coupleRole2 } = playerInfo;
        if ((WOLF_ROLES.has(coupleRole1) && WOLF_ROLES.has(coupleRole2)) || (WOLF_ROLES.has(coupleRole1) && coupleRole2 === null)) {
            return; // Both lovers are wolves, or I'm a solo wolf lover. Do nothing.
        }

        const isPriestCoupled = coupleRole1 === 'Priest' || coupleRole2 === 'Priest';
        const isPartnerAWolf = !WOLF_ROLES.has(playerInfo.coupleRole1);
        const partnerNumber = isPartnerAWolf ? playerInfo.coupleNumber1 : playerInfo.coupleNumber2;
        const partnerElement = isPartnerAWolf ? coupleElements[0] : coupleElements[1];
        
        sendMessageAndAct(isPriestCoupled ? `${partnerNumber} priest` : partnerNumber, partnerElement);

        await waitForExactText('5s', { cancelText: 'Continue' });
        if (gameIsOver() || findTextInDocument('Voting')) return;

        // Complex logic to avoid voting for Junior Werewolf
        for (const playerElement of allPlayerElements) {
            const images = playerElement.querySelectorAll('img');
            let roleImage = '';
            for (let i = images.length - 1; i >= 0; i--) {
                const src = images[i].src;
                if (src.includes('vote_day') || src.includes('vote_werewolves') || src.includes('hand-skin')) continue;
                roleImage = src.slice(src.lastIndexOf('/') + 1);
                break;
            }
            if (roleImage && getPlayerRole(roleImage) === 'Junior Werewolf') {
                // This player is the Junior Werewolf, check if they are the target
                for (const img of images) {
                    if (img.src.includes('vote_werewolves_voter')) {
                        if (!isPriestCoupled) {
                            clickOutermostElement(partnerElement); // Re-click my partner
                        }
                        break;
                    }
                }
            }
        }
        await waitForTextInDOM('Voting', { cancelText: 'Continue' });

    } else if (playerInfo.role === 'Junior Werewolf') {
        await handleWolfTagging(/.*junior_werewolf_selection_marker.*\.png/);
    } else if (playerInfo.role === 'Split Wolf') {
        await handleWolfTagging(/.*splitwolf_bind.*\.png/);
    }
}

/**
 * Handles the logic for the game lobby (e.g., clicking "START GAME").
 */
async function handleLobbyState() {
    // 1. Check for "MORE PLAYERS REQUIRED" button and refresh if found.
    const morePlayersButton = Array.from(document.querySelectorAll('[tabindex="0"]')).find(el =>
        el.textContent.includes('MORE PLAYERS REQUIRED')
    );

    if (morePlayersButton) {
        log("'MORE PLAYERS REQUIRED' button found. Refreshing page to find a new lobby.");
        location.reload();
        return; // Stop further actions in this cycle.
    }

    // The brittle position check (`.top > 100`) was removed in favor of the more reliable isVisible().
    const startGameButton = Array.from(document.querySelectorAll('[tabindex="0"]')).find(el =>
        el.textContent.includes('START GAME') && isVisible(el)
    );
}

/**
 * Handles the logic for the role selection screen.
 */
async function handleRoleSelectionState() {
    if (findImageInDocument('instigator')) {
        // The bot wants to be Cupid if it gets the Instigator role.
        clickInnermostElementByImage('cupid');
    }
}

/**
 * Analyzes the page to determine the current game state.
 * @returns {string} The current state from the GameState object.
 */
function determineGameState() {
    const pageText = document.body.innerText;

    // The order of these checks is important. More specific/dominant states should be checked first.

    // 1. Post-game and In-game states are very specific and should be checked before menu/lobby states.
    if (pageText.includes('Continue')) {
        return GameState.POST_GAME;
    }
    if ((pageText.includes('Welcome to the werewolves chat.') || pageText.includes('Voting')) && !gameIsOver()) {
        return GameState.IN_GAME;
    }
    // 2. Role selection is a clear state between lobby and game.
    if (pageText.includes('SELECT A ROLE') || pageText.includes('Team: You belong to')) {
        return GameState.ROLE_SELECTION;
    }
    // 3. Menu states. By checking for specific menu screens before the general lobby,
    // we can simplify the logic. The order here is from most-specific to least-specific.
    if (pageText.includes('CREATE GAME')) {
        return GameState.CUSTOM;
    }
    if (pageText.includes('CUSTOM GAME')) {
        return GameState.GAME_SCREEN;
    }
    if (pageText.includes('INVENTORY')) {
        return GameState.HOME_SCREEN;
    }
    // 4. The lobby is the "default" waiting state. This check is now simple because
    // the more specific menu states have already been ruled out.
    if (pageText.includes('START GAME') && pageText.includes('INVITE')) {
        return GameState.LOBBY;
    }

    return GameState.UNKNOWN;
}

/**
 * Parses the initial game state to build the playerInfo object.
 * @param {string} myName The active player's name.
 */
async function inGame(myName) {
    // Find all player containers
    const allPlayerElements = Array.from(document.querySelectorAll('[style*="flex-direction: column"]'))
        .filter(el => /^\d+\s/.test(el.textContent.trim()));

    // Find lovers (players with the cupid sticker)
    const loverElements = allPlayerElements
        .filter(el => Array.from(el.querySelectorAll('img')).some(img => img.src.includes('cupid_select_lovers_sticker_small')));

    // The two lovers are the ones that are NOT me
    const coupleElements = loverElements.filter(el => !el.textContent.includes(myName));
    while (coupleElements.length < 2) coupleElements.push(null); // Pad with null if not found

    const getPlayerImageFilenames = (elements) => elements.map(el =>
        Array.from(el.querySelectorAll('img')).map(img => {
            const parts = img.src.split('/');
            return parts[parts.length - 1];
        })
    );

    const coupleImageSets = getPlayerImageFilenames(loverElements.filter(el => !el.textContent.includes(myName)));
    const myImageSets = getPlayerImageFilenames(loverElements.filter(el => el.textContent.includes(myName)));

    const extractRoleImage = (imageSets) => imageSets.map(set => {
        let i = set.length - 1;
        while (set[i]?.includes('vote_day') || set[i]?.includes('hand-skin') || set[i]?.includes('cupid')) {
            i -= 1;
        }
        return set[i];
    });

    const myRoleImages = extractRoleImage(myImageSets);
    const coupleRoleImages = extractRoleImage(coupleImageSets);

    const myPlayerElement = allPlayerElements.find(el => el.textContent.includes(myName));
    const getPlayerNumber = (el) => el ? (el.textContent.match(/\d+/)?.[0] || null) : null;
    const getRoleFromImage = (img) => img ? getPlayerRole(img) : null;

    const playerInfo = {
        name: myName,
        number: getPlayerNumber(myPlayerElement),
        role: getPlayerRole(myRoleImages[0]),
        coupleNumber1: getPlayerNumber(coupleElements[0]),
        coupleRole1: getRoleFromImage(coupleRoleImages[0]),
        coupleNumber2: getPlayerNumber(coupleElements[1]),
        coupleRole2: getRoleFromImage(coupleRoleImages[1]),
    };

    log('Player object:', playerInfo);
    log(`Detected phase: ${isDay() ? 'Day' : isNight() ? 'Night' : 'Unknown'}`);

    if (isDay()) {
        await inGameDay(playerInfo, coupleElements, myImageSets, allPlayerElements);
    } else if (isNight()) {
        await inGameNight(playerInfo, coupleElements, allPlayerElements);
    }
}


/**
 * Handles the logic for post-game screens.
 */
async function playAgain() {
    if (findTextInDocument('Waiting for players')) return;

    /**
     * A more robust function to find, wait, click, and verify a button press.
     * It waits for a button, adds a cooldown, clicks it, and verifies it disappears.
     * @param {string} buttonText The text on the button to click.
     * @param {object} [options={}]
     * @param {string | string[]} [options.cancelText=null] Text(s) that, if found, cancel the wait.
     * @param {number} [options.timeout=10000] The maximum time to wait for the button.
     * @param {number} [options.preClickDelay=0] A cooldown in ms to wait before clicking.
     */
    const robustClickAndVerify = async (buttonText, options = {}) => {
        const { cancelText = null, timeout = 10000, preClickDelay = 200 } = options;
        log(`Attempting robust click for: "${buttonText}"`);
        
        // Define a function to find the button. This will be reused.
        const findButtonFn = () => {
            const candidates = Array.from(document.querySelectorAll('[tabindex="0"]'))
                .filter(el => el.textContent.includes(buttonText) && isVisible(el));

            if (candidates.length === 0) return null;

            // If multiple elements match, assume the most deeply nested one is the actual button.
            // This avoids clicking a large container that also contains the button text, which was causing incorrect click coordinates.
            let deepestElement = candidates[0];
            let maxDepth = 0;

            for (const el of candidates) {
                let depth = 0;
                let parent = el.parentElement;
                while (parent) {
                    depth++;
                    parent = parent.parentElement;
                }
                if (depth > maxDepth) {
                    maxDepth = depth;
                    deepestElement = el;
                }
            }
            return deepestElement;
        };
        
        // 1. Wait for the button to appear and be visible.
        const button = await waitForCondition(findButtonFn, timeout, 200, cancelText);

        if (!button) {
            log(`Button with text "${buttonText}" not found or wait was cancelled.`);
            return false;
        }

        // 2. Add a small delay (cooldown) before clicking to ensure it's interactive.
        if (preClickDelay > 0) {
            log(`Found "${buttonText}", waiting ${preClickDelay}ms before clicking.`);
            await sleep(preClickDelay);
        }

        // 3. Click and verify that the button disappears. Retry if it doesn't.
        for (let i = 0; i < 5; i++) {
            const freshButton = findButtonFn();
            if (!freshButton) {
                log(`"${buttonText}" disappeared before click attempt ${i + 1}. Success.`);
                return true;
            }
            
            click(freshButton);

            // Wait for the button to disappear by checking if the find function returns null.
            const disappeared = await waitForCondition(() => !findButtonFn(), 2000, 100);
            if (disappeared) {
                log(`Successfully clicked "${buttonText}" and it disappeared.`);
                return true; // Success!
            }
            log(`Clicked "${buttonText}" but it didn't disappear. Retrying... (${i + 1}/5)`);
            await sleep(500); // Wait before retrying
        }
        log(`Failed to verify click for "${buttonText}" after 3 attempts.`);
        return false;
    };

    // 1. Sequentially click the post-game buttons using the new robust logic.
    await robustClickAndVerify('Continue', { cancelText: ['START GAME', 'Play again'] });
    // "Play again" does not need a pre-click delay.
    const playAgainSuccess = await robustClickAndVerify('Play again', { cancelText: 'INVENTORY', timeout: 120000 });

    // If the "Play again" button isn't found or clicked successfully within the timeout,
    // refresh the page as a recovery mechanism.
    if (!playAgainSuccess) {
        log("'Play again' button flow failed after 120s timeout. Refreshing page.");
        location.reload();
        return;
    }

    // 2. Handle the optional "Are you sure you want to leave?" popup.
    const findOkButton = () => Array.from(document.querySelectorAll('[tabindex="0"]')).find(el => {
        if (!el.textContent.includes('OK') || !isVisible(el) || el.getBoundingClientRect().top <= 100) return false;
        return Array.from(el.parentElement?.querySelectorAll('[tabindex="0"]') || []).some(sibling =>
            sibling !== el && sibling.textContent.includes('Cancel') && isVisible(sibling)
        );
    });

    const okButton = await waitForCondition(findOkButton, 3000, 200);
    if (okButton) {
        log("Found 'OK' button in leave confirmation, clicking it.");
        click(okButton);
    }
}

/**
 * Handles the logic for the main home screen.
 * For now, just logs that the state has been detected.
 */
async function handleHomeScreen() {
    log("State handler called: HOME_SCREEN. Waiting up to 5s for potential rejoin popup...");

    // Wait up to 5 seconds to see if the "rejoin" popup appears.
    const rejoinPopupText = await waitForTextInDOM('Your game is still running', { timeout: 3000 });

    if (rejoinPopupText) {
        log("Rejoin popup detected. Attempting to click 'Join'.");
        const joinButton = findDeepestClickableElementByText('Join');
        if (joinButton) {
            log(`Found clickable element for "Join":`, joinButton);
            click(joinButton);
            await sleep(500);
        } else {
            log("Could not find a clickable 'Join' button on the rejoin popup.");
        }
        return; // We've handled the action for this state.
    }

    // If the rejoin popup did not appear after the wait, proceed to click "PLAY".
    log("No rejoin popup found. Attempting to click 'PLAY'.");
    const playButton = findDeepestClickableElementByText('PLAY', { exclude: 'FRIENDS' });
    if (playButton) {
        log(`Found clickable element for "PLAY":`, playButton);
        click(playButton);
        await sleep(3000); // Give the UI a moment to transition
    } else {
        log(`Could not find a clickable element with text "PLAY".`);
    }
}

/**
 * Handles the logic for the game selection screen.
 */
async function handleGameScreen() {
    log("State handler called: GAME_SCREEN. Attempting to click 'CUSTOM GAME'.");

    // 1. Find and click the 'CUSTOM GAME' button first.
    const customGameButton = findDeepestClickableElementByText('CUSTOM GAME');
    if (!customGameButton) {
        log(`Could not find a clickable element with text "CUSTOM GAME".`);
        return;
    }

    log(`Found clickable element for "CUSTOM GAME":`, customGameButton);
    click(customGameButton);
    await sleep(500); // Give the UI a moment for the popup to potentially appear.

    // 2. Now, check for the "fleeing" popup that might have appeared after the click.
    const fleePopupText = 'Your previous game is still running';
    const popupElement = await waitForTextInDOM(fleePopupText, { timeout: 2000 });

    if (popupElement) {
        log(`'${fleePopupText}' popup detected. Clicking 'Cancel'.`);
        const cancelButton = findDeepestClickableElementByText('Cancel');
        if (cancelButton) {
            click(cancelButton);
            await sleep(500);
        } else {
            log("Could not find a 'Cancel' button on the popup.");
        }
    }
}

async function customLobby() {
    log("In Custom Lobby...");

    // 1. Check for "Game has already started" popup.
    const gameStartedText = 'This game cannot be joined because it has already started.';
    if (findTextInDocument(gameStartedText)) {
        log("'Game has already started' popup detected. Clicking 'OK'.");
        const okButton = findDeepestClickableElementByText('OK');
        if (okButton) {
            await click(okButton);
            await sleep(500); // Wait for popup to close
        }
        return; // Stop further actions in this cycle.
    }

    // 2. Look for a lobby with 'nt' in the title (case-insensitive).
    const lobbyToJoin = Array.from(document.querySelectorAll('[tabindex="0"]')).find(el => {
        if (!isVisible(el)) {
            return false;
        }

        // Find the specific div for the lobby name.
        // Based on the provided HTML, the lobby name has a distinct class.
        // This is more reliable than checking the entire textContent of the lobby element.
        const lobbyNameEl = el.querySelector('div.r-1b43r93');
        if (!lobbyNameEl) {
            return false;
        }

        // Use a case-insensitive regex to find "NT" or "nt" as a whole word.
        return /\bNT\b/i.test(lobbyNameEl.textContent);
    });

    if (lobbyToJoin) {
        log(`Found NT lobby: "${lobbyToJoin.textContent.trim()}". Clicking it.`);
        await click(lobbyToJoin);

        const findJoinButton = () => Array.from(document.querySelectorAll('[tabindex="0"]'))
                .find(el => el.textContent.includes('Join') && isVisible(el));

        // After clicking the lobby, wait for the "Join" button to appear.
        // The 'CREATE GAME' text is still visible behind the popup, so we can't use it as a cancel condition.
        const joinButton = await waitForCondition(findJoinButton, 5000, 200);
        
        if (joinButton) {
            // Verify it's an NT lobby by checking for the "Enable talismans" text.
            if (findTextInDocument('Enable talismans')) {
                log('Found "Join" button and "Enable talismans" text. Clicking Join.');
                await click(joinButton);
                // Wait for the join button to disappear to prevent re-clicking the lobby.
                const joined = await waitForCondition(() => !findJoinButton(), 5000, 100);
                if (joined) {
                    log('Successfully joined lobby, "Join" button is gone.');
                } else {
                    log('Clicked "Join", but it did not disappear. State might be stuck.');
                }
            } else {
                log('"Join" button found, but "Enable talismans" text is missing. Not an NT lobby. Closing popup.');
                // Attempt to find and click a close or cancel button.
                const closeButton = Array.from(document.querySelectorAll('[tabindex="0"]'))
                    .find(el => (el.textContent.toLowerCase() === 'cancel' || el.textContent.toLowerCase() === 'x') && isVisible(el));
                
                if (closeButton) {
                    await click(closeButton);
                    await sleep(500); // Wait for the popup to close.
                } else {
                    log("Could not find a close/cancel button for the lobby popup. Will rely on next cycle to recover.");
                }
            }
        } else {
            log('"Join" button not found after clicking lobby.');
        }
        return; // Exit after attempting to join.
    }
    
    log("No 'NT' lobby found or popup to dismiss.");
}

// --- Main Bot Loop & Control ---

/**
 * The main function that runs in a loop, determining the game state and calling the appropriate handler.
 * @param {string} myName The active player's name.
 */
async function main(myName) {
    const currentState = determineGameState();
    log(`State check: ${currentState}`);

    // Timeout logic for being stuck in the lobby
    if (currentState === GameState.LOBBY) {
        if (lobbyEntryTimestamp === null) {
            lobbyEntryTimestamp = Date.now();
            log(`Entered LOBBY state. Starting 2-minute timeout.`);
        } else {
            const timeInLobby = Date.now() - lobbyEntryTimestamp;
            if (timeInLobby > LOBBY_TIMEOUT) {
                log(`Stuck in LOBBY state for more than ${LOBBY_TIMEOUT / 1000 / 60} minutes. Reloading page.`);
                location.reload();
                return; // Stop execution to allow the page to reload
            }
        }
    } else {
        // Reset the timestamp if we are no longer in the lobby
        if (lobbyEntryTimestamp) log(`Exited LOBBY state. Resetting timeout.`);
        lobbyEntryTimestamp = null;
    }

    switch (currentState) {
        case GameState.LOBBY:
            await handleLobbyState();
            break;
        case GameState.ROLE_SELECTION:
            await handleRoleSelectionState();
            break;
        case GameState.IN_GAME:
            await inGame(myName);
            break;
        case GameState.POST_GAME:
            await playAgain();
            break;
        case GameState.CUSTOM:
            await customLobby();
            break;
        case GameState.HOME_SCREEN:
            await handleHomeScreen();
            break;
        case GameState.GAME_SCREEN:
            await handleGameScreen();
            break;
        case GameState.UNKNOWN:
            break;
    }
}


let BOT_RUNNING = false;
let ACTIVE_NAME = '';
let loopHandle = null;
let lobbyEntryTimestamp = null;
const LOBBY_TIMEOUT = 2 * 60 * 1000; // 2 minutes in milliseconds

/** Starts the main bot loop. */
function startBot(name) {
    if (BOT_RUNNING) return;
    BOT_RUNNING = true;
    ACTIVE_NAME = name;
    console.log('[Λbstract] Starting bot as', name); // Keep this one for explicit user feedback
    // The sendHeartbeat function is an online-only feature.
    // It's commented out to prevent errors and ensure offline functionality.

    async function loop() {
        try {
            await main(name);
        } catch (error) {
            console.error('[Λbstract] main() error:', error); // Keep errors visible
        } finally {
            if (BOT_RUNNING) {
                loopHandle = setTimeout(loop, 1500); // Check game state more frequently.
            }
        }
    }
    loop();
}

/** Stops the main bot loop. */
function stopBot() {
    if (!BOT_RUNNING) return;
    BOT_RUNNING = false;
    console.log('[Λbstract] Bot paused'); // Keep this one for explicit user feedback
    if (loopHandle) {
        clearTimeout(loopHandle);
    }
}

/**
 * Exposes a status check function to the browser console for debugging.
 * Can be called by typing `abstractStatus()` in the console.
 */
function checkStatus() {
    if (BOT_RUNNING) {
        console.log(
            `%c[Λbstract] Bot is RUNNING. %c\nVersion: ${CLIENT_VERSION}\nPlayer: ${ACTIVE_NAME}`,
            'color: #4CAF50; font-weight: bold;',
            'color: inherit; font-weight: normal;'
        );
    } else {
        console.log(
            `%c[Λbstract] Bot is STOPPED. %c\nVersion: ${CLIENT_VERSION}`,
            'color: #F44336; font-weight: bold;',
            'color: inherit; font-weight: normal;'
        );
    }
}
window.abstractStatus = checkStatus;

/**
 * Injects a small script into the main page's context to provide console access.
 * This is necessary because content scripts run in an isolated world, and the
 * console cannot access their functions directly. This creates a bridge.
 */
function grantConsoleAccess() {
    // Create a script tag to load our bridge script.
    const script = document.createElement('script');
    // Load the script from the extension's resources. This is allowed by the site's CSP,
    // whereas inline scripts are not. The path must match what's in manifest.json.
    script.src = chrome.runtime.getURL('bridge.js');
    // Once the script is loaded and executed, we can remove the tag from the DOM.
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);

    // The content script still listens for the event dispatched by the injected script.
    window.addEventListener('__abstract_check_status_request', () => checkStatus());
}

/**
 * Listens for messages from the popup/background script to toggle the bot.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action !== 'toggleBot') {
        return;
    }

    if (message.enabled) {
        startBot(message.name);
    } else {
        stopBot();
    }

    sendResponse?.({ ok: true });
    return true; // Indicates we will respond asynchronously
});

// --- Initialization ---
// Defer granting console access until the DOM is ready to avoid race conditions,
// especially since the content script runs at `document_start`.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', grantConsoleAccess, { once: true });
} else {
    grantConsoleAccess();
}

// --- Auto-start on page load ---
// Checks the stored state when the content script is loaded. If the bot was
// previously enabled, it will start automatically without needing the popup.
(function() {
    const STORAGE_KEY_STATE = 'abstract_state';
    const STORAGE_KEY_NAME = 'abstract_name';

    chrome.storage.local.get([STORAGE_KEY_STATE, STORAGE_KEY_NAME], (storage) => {
        const isRunning = storage[STORAGE_KEY_STATE] || false;
        const name = storage[STORAGE_KEY_NAME] || 'Player'; // Default name if not set

        if (isRunning) {
            log('Bot state is ENABLED. Auto-starting on page load.');
            startBot(name);
        } else {
            log('Bot state is DISABLED. Waiting for user to enable.');
        }
    });
})();

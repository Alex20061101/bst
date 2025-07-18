/*
 * This file is the core content script for the "Λbstract" extension.
 * It contains the automation logic (the "bot") for playing wolvesville.com.
 */

const CLIENT_VERSION = '1.6';
const WOLF_ROLES = new Set(['Wolf', 'Junior Werewolf', 'Split Wolf']);

// --- Core Helper & Utility Functions ---

/**
 * Sends a message to the background script to perform a click at the element's center.
 * @param {HTMLElement} element The element to click.
 * @param {string} [button='left'] The mouse button to simulate.
 */
function click(element, button = 'left') {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    console.log(`[Λbstract] Request click @ ${x}, ${y} → ${element.textContent.trim()}`);
    chrome.runtime.sendMessage({ action: 'performClick', x, y, button }, response => {
        if (chrome.runtime.lastError) {
            console.error(`[Λbstract] sendMessage error: ${chrome.runtime.lastError.message}`);
        } else {
            console.log('[Λbstract] BG responded:', response);
        }
    });
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
 * @param {string | null} cancelText If this text appears in the DOM, the wait is cancelled.
 * @returns {Promise<any | null>} The result of the condition function or null if timed out/cancelled.
 */
function waitForCondition(conditionFn, timeout, interval, cancelText) {
    return new Promise(resolve => {
        const startTime = Date.now();
        const check = () => {
            const result = conditionFn();
            if (result) {
                return resolve(result);
            }
            if (cancelText && document.body.innerText.includes(cancelText)) {
                return resolve(null);
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
        const elementToClick = findElementFn();
        if (!elementToClick) break;

        click(elementToClick);
        await sleep(300);

        const isStillVisible = Array.from(document.querySelectorAll('*'))
            .some(el => el.textContent.includes(verifyDisappearText) && isVisible(el));

        if (!isStillVisible) break;
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
    console.log(`[Λ] shooterAction: looking for ${voteMarkersToFind} vote marker(s)`);
    const VOTE_MARKER_IMG = 'vote_day_selected';
    if (voteMarkersToFind > 4) return;

    await waitForImageCountInDOM(VOTE_MARKER_IMG, voteMarkersToFind, { timeout: 90000, cancelText: 'Continue' });
    if (gameIsOver()) return;

    console.log('[Λ] Clicking bullet icon...');
    clickElementByImage(/.*gunner_bullet.*\.png/);
    await sleep(200);

    // Find a player who is voted for, is not a lover, and is not self
    const target = allPlayerElements.find(el =>
        findImageInElement(el, new RegExp(`.*${VOTE_MARKER_IMG}.*\\.png`)) &&
        !coupleElements.includes(el) &&
        !el.textContent.includes(playerInfo.name)
    );

    if (target) {
        console.log('[Λ] Shooter found target:', target?.textContent.trim());
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

    console.log(`[Λ] inGameDay(): role = ${playerInfo.role} | Lovers = ${coupleElements.map(c => c?.textContent.trim())}`);

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
            console.log('[Λ] Wolf sending number:', playerInfo.number);
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

            console.log('[Λ] Role ability triggered:', playerInfo.role);
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
            console.log('[Λ] Voting couple:', targetLover.textContent.trim());
            clickOutermostElement(targetLover);
        }

        if (playerInfo.role === 'Priest') {
            console.log('[Λ] Role ability triggered:', playerInfo.role);
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
    console.log(`[Λ] inGameNight(): role = ${playerInfo.role}`);

    // --- Night Helper Functions ---
    const sendMessageAndAct = async (message, targetElement) => {
        if (gameIsOver()) return;
        console.log(`[Λ] sendAction: ${message} | Target: ${targetElement?.textContent.trim()}`);
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

        console.log('[Λ] handleWolfTag() triggered for:', playerInfo.role);
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
            console.log('[Λ] Target number chosen:', taggedNumber);
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

    console.log('[Λ] Player object:', playerInfo);
    console.log(`[Λ] Detected phase: ${isDay() ? 'Day' : isNight() ? 'Night' : 'Unknown'}`);

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
    if (document.body.innerText.includes('Waiting for players')) return;

    // Click "Continue" button
    await clickAndVerifyDisappear('Continue', () =>
        Array.from(document.querySelectorAll('[tabindex="0"]')).find(el =>
            el.textContent.includes('Continue') && isVisible(el) && el.getBoundingClientRect().top > 100
        )
    );

    // Click "Play again" button
    await waitForTextInDOM('Play again', { cancelText: 'INVENTORY' });
    const playAgainButton = Array.from(document.querySelectorAll('[tabindex="0"]')).find(el =>
        el.textContent.includes('Play again') && isVisible(el) && el.getBoundingClientRect().top > 100
    );
    if (playAgainButton) {
        click(playAgainButton);
    }
    await sleep(300);

    // Handle the "Are you sure you want to leave?" popup by clicking "OK"
    await waitForCondition(() => {
        return Array.from(document.querySelectorAll('[tabindex="0"]')).some(el => {
            if (!el.textContent.includes('OK') || !isVisible(el) || el.getBoundingClientRect().top <= 100) return false;
            // Make sure there is a "Cancel" button nearby to confirm it's the right popup
            return Array.from(el.parentElement?.querySelectorAll('[tabindex="0"]') || []).some(sibling =>
                sibling !== el && sibling.textContent.includes('Cancel') && isVisible(sibling)
            );
        });
    }, 3000, 200);

    const okButton = Array.from(document.querySelectorAll('[tabindex="0"]')).find(el => {
        if (!el.textContent.includes('OK') || !isVisible(el) || el.getBoundingClientRect().top <= 100) return false;
        return Array.from(el.parentElement?.querySelectorAll('[tabindex="0"]') || []).some(sibling =>
            sibling !== el && sibling.textContent.includes('Cancel') && isVisible(sibling)
        );
    });

    if (okButton) {
        click(okButton);
    }
    await sleep(300);
}

// --- Main Bot Loop & Control ---

/**
 * The main function that runs in a loop, determining the game state and calling the appropriate handler.
 * @param {string} myName The active player's name.
 */
async function main(myName) {
    const pageText = document.body.innerText;

    // In lobby or waiting
    if (pageText.includes('MORE PLAYERS REQUIRED') || pageText.includes('START GAME')) {
        const startGameButton = Array.from(document.querySelectorAll('[tabindex="0"]')).find(el =>
            el.textContent.includes('START GAME') && isVisible(el) && el.getBoundingClientRect().top > 100
        );
        if (startGameButton) {
            click(startGameButton);
        }
    }

    // Special role selection (e.g., Instigator)
    if (pageText.includes('SELECT A ROLE') || pageText.includes('Team: You belong to')) {
        if (findImageInDocument('instigator')) {
            return clickInnermostElementByImage('cupid');
        }
    }

    // Game has ended
    if (pageText.includes('Continue')) {
        return await playAgain();
    }

    // Game is in progress
    if ((pageText.includes('Welcome to the werewolves chat.') || pageText.includes('Voting')) && !gameIsOver()) {
        await inGame(myName);
    }
}


let BOT_RUNNING = false;
let ACTIVE_NAME = '';
let loopHandle = null;

/** Starts the main bot loop. */
function startBot(name) {
    if (BOT_RUNNING) return;
    BOT_RUNNING = true;
    ACTIVE_NAME = name;
    console.log('[Λbstract] Starting bot as', name);
    // The sendHeartbeat function is an online-only feature.
    // It's commented out to prevent errors and ensure offline functionality.

    async function loop() {
        try {
            await main(name);
        } catch (error) {
            console.error('[Λbstract] main() error:', error);
        } finally {
            if (BOT_RUNNING) {
                loopHandle = setTimeout(loop, 1000);
            }
        }
    }
    loop();
}

/** Stops the main bot loop. */
function stopBot() {
    if (!BOT_RUNNING) return;
    BOT_RUNNING = false;
    console.log('[Λbstract] Bot paused');
    if (loopHandle) {
        clearTimeout(loopHandle);
    }
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
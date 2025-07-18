// This script runs in the main page's world.
// Its only job is to create a bridge for the console to communicate with the content script.
window.abstractStatus = function() {
    // Dispatch a custom event that the content script (in its isolated world) can listen for.
    window.dispatchEvent(new CustomEvent('__abstract_check_status_request'));
};
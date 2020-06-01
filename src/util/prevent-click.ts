/**
 * Stops propagation of click event and removes event listener
 *
 * @private
 * @param {object} event The click event
 */
function preventClickHandler(event: Event) {
    event.stopPropagation();
    document.body.removeEventListener("click", preventClickHandler, true);
}

/**
 * Starts listening for click event and prevent propagation
 */
export default function preventClick() {
    document.body.addEventListener("click", preventClickHandler, true);
}

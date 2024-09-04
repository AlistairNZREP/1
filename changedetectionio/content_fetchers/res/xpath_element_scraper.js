// Copyright (C) 2021 Leigh Morresi (dgtlmoon@gmail.com)
// All rights reserved.

// @file Scrape the page looking for elements of concern (%ELEMENTS%)
// http://matatk.agrip.org.uk/tests/position-and-width/
// https://stackoverflow.com/questions/26813480/when-is-element-getboundingclientrect-guaranteed-to-be-updated-accurate
//
// Some pages like https://www.londonstockexchange.com/stock/NCCL/ncondezi-energy-limited/analysis
// will automatically force a scroll somewhere, so include the position offset
// Lets hope the position doesnt change while we iterate the bbox's, but this is better than nothing
var scroll_y = 0;
try {
    scroll_y = +document.documentElement.scrollTop || document.body.scrollTop
} catch (e) {
    console.log(e);
}

const percentageNumerical = str => Math.round((str.match(/\d/g) || []).length / str.length * 100);

// Include the getXpath script directly, easier than fetching
function getxpath(e) {
    var n = e;
    if (n && n.id) return '//*[@id="' + n.id + '"]';
    for (var o = []; n && Node.ELEMENT_NODE === n.nodeType;) {
        for (var i = 0, r = !1, d = n.previousSibling; d;) d.nodeType !== Node.DOCUMENT_TYPE_NODE && d.nodeName === n.nodeName && i++, d = d.previousSibling;
        for (d = n.nextSibling; d;) {
            if (d.nodeName === n.nodeName) {
                r = !0;
                break
            }
            d = d.nextSibling
        }
        o.push((n.prefix ? n.prefix + ":" : "") + n.localName + (i || r ? "[" + (i + 1) + "]" : "")), n = n.parentNode
    }
    return o.length ? "/" + o.reverse().join("/") : ""
}

const findUpTag = (el) => {
    let r = el
    chained_css = [];
    depth = 0;

    //  Strategy 1: If it's an input, with name, and there's only one, prefer that
    if (el.name !== undefined && el.name.length) {
        var proposed = el.tagName + "[name=" + el.name + "]";
        var proposed_element = window.document.querySelectorAll(proposed);
        if (proposed_element.length) {
            if (proposed_element.length === 1) {
                return proposed;
            } else {
                // Some sites change ID but name= stays the same, we can hit it if we know the index
                // Find all the elements that match and work out the input[n]
                var n = Array.from(proposed_element).indexOf(el);
                // Return a Playwright selector for nthinput[name=zipcode]
                return proposed + " >> nth=" + n;
            }
        }
    }

    // Strategy 2: Keep going up until we hit an ID tag, imagine it's like  #list-widget div h4
    while (r.parentNode) {
        if (depth === 5) {
            break;
        }
        if ('' !== r.id) {
            chained_css.unshift("#" + CSS.escape(r.id));
            final_selector = chained_css.join(' > ');
            // Be sure theres only one, some sites have multiples of the same ID tag :-(
            if (window.document.querySelectorAll(final_selector).length === 1) {
                return final_selector;
            }
            return null;
        } else {
            chained_css.unshift(r.tagName.toLowerCase());
        }
        r = r.parentNode;
        depth += 1;
    }
    return null;
}
// Text width scraper for ML training/detection
// Create a single canvas and get its 2D context
const canvas = document.createElement("canvas");
const context = canvas.getContext("2d");

// Function to get the width and height of the text inside an element and round them to the nearest integer
function getTextWidthAndHeightinPx(element) {
    // Set the font to match the style of the text in the element
    context.font = window.getComputedStyle(element).font;

    // Get the text inside the element
    const text = element.textContent || element.innerText;

    // Measure the text width
    const metrics = context.measureText(text);
    const width = Math.round(metrics.width);

    // Get the font size from the computed style
    const fontSize = parseFloat(window.getComputedStyle(element).fontSize);
    const height = Math.round(fontSize); // Using font size as an approximation of height

    // Return both width and height as an object
    return { textWidth: width, textHeight: height };
}


// @todo - if it's SVG or IMG, go into image diff mode
// %ELEMENTS% replaced at injection time because different interfaces use it with different settings

var size_pos = [];
// after page fetch, inject this JS
// build a map of all elements and their positions (maybe that only include text?)
var bbox;
console.log("Scanning %ELEMENTS%");

function collectVisibleElements(parent, visibleElements) {
    if (!parent) return; // Base case: if parent is null or undefined, return


    // Add the parent itself to the visible elements array if it's of the specified types
    const tagName = parent.tagName.toLowerCase();
    if ("%ELEMENTS%".split(',').includes(tagName)) {
        visibleElements.push(parent);
    }

    // Iterate over the parent's children
    const children = parent.children;
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (
            child.nodeType === Node.ELEMENT_NODE &&
            window.getComputedStyle(child).display !== 'none' &&
            window.getComputedStyle(child).visibility !== 'hidden' &&
            child.offsetWidth >= 0 &&
            child.offsetHeight >= 0 &&
            window.getComputedStyle(child).contentVisibility !== 'hidden'
        ) {
            // If the child is an element and is visible, recursively collect visible elements
            collectVisibleElements(child, visibleElements);
        }
    }
}

// Create an array to hold the visible elements
const visibleElementsArray = [];

// Call collectVisibleElements with the starting parent element
collectVisibleElements(document.body, visibleElementsArray);

// Append any custom selectors to the visibleElementsArray


function get_element_metadata(element) {

    bbox = element.getBoundingClientRect();

    // Skip really small ones, and where width or height ==0
    if (bbox['width'] * bbox['height'] < 10) {
        return
    }

    // Don't include elements that are offset from canvas
    if (bbox['top'] + scroll_y < 0 || bbox['left'] < 0) {
        return
    }

    // @todo the getXpath kind of sucks, it doesnt know when there is for example just one ID sometimes
    // it should not traverse when we know we can anchor off just an ID one level up etc..
    // maybe, get current class or id, keep traversing up looking for only class or id until there is just one match

    // 1st primitive - if it has class, try joining it all and select, if theres only one.. well thats us.
    xpath_result = false;
    try {
        var d = findUpTag(element);
        if (d) {
            xpath_result = d;
        }
    } catch (e) {
        console.log(e);
    }
    // You could swap it and default to getXpath and then try the smarter one
    // default back to the less intelligent one
    if (!xpath_result) {
        try {
            // I've seen on FB and eBay that this doesnt work
            // ReferenceError: getXPath is not defined at eval (eval at evaluate (:152:29), <anonymous>:67:20) at UtilityScript.evaluate (<anonymous>:159:18) at UtilityScript.<anonymous> (<anonymous>:1:44)
            xpath_result = getxpath(element);
        } catch (e) {
            console.log(e);
            return
        }
    }

    let label = "none" // A placeholder, the actual labels for training are done by hand for now

    // Check if the element was found and get its text , not including any child element
    let text = Array.from(element.childNodes)
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent)
        .join('');

    // Remove any gaps in sequences of newlines and tabs inside the string
    text = text.trim().replace(/[\s\t\n\r]{2,}/g, ' ').trim();

    // Try to identify any possible currency amounts "Sale: 4000" or "Sale now 3000 Kc", can help with the training.
    // @todo could be instead of USD/AUD etc [A-Z]{2,3} ?
    //const hasDigitCurrency = (/\d/.test(text.slice(0, 6)) || /\d/.test(text.slice(-6)) ) &&  /([€£$¥₩₹]|USD|AUD|EUR|Kč|kr|SEK|RM|,–)/.test(text) ;
    const hasDigitCurrency = (/\d/.test(text.slice(0, 6)) || /\d/.test(text.slice(-6)) ) &&  /([€£$¥₩₹]|USD|AUD|EUR|Kč|kr|SEK|RM|,–)/.test(text) ;
    const hasDigit = /[0-9]/.test(text) ;

    // Sizing of the actual text inside the element can be very different from the elements size
    const { textWidth, textHeight } = getTextWidthAndHeightinPx(element);

    const computedStyle = window.getComputedStyle(element);
    let red, green, blue;

    if (text.length) {
        // Extract the RGB values from the color string (format: rgb(r, g, b))
        [red, green, blue] = computedStyle.color.match(/\d+/g).map(Number);
    } else {
        // Assign default values if text is empty
        [red, green, blue] = [0, 0, 0];
    }
    return {
        xpath: xpath_result,
        width: Math.round(bbox['width']),
        height: Math.round(bbox['height']),
        left: Math.floor(bbox['left']),
        top: Math.floor(bbox['top']) + scroll_y,
        // tagName used by Browser Steps
        tagName: (element.tagName) ? element.tagName.toLowerCase() : '',
        // tagtype used by Browser Steps
        tagtype: (element.tagName.toLowerCase() === 'input' && element.type) ? element.type.toLowerCase() : '',
        isClickable: window.getComputedStyle(element).cursor === "pointer",
        // Used by the keras/pytorch trainer
        fontSize: window.getComputedStyle(element).getPropertyValue('font-size'),
        fontWeight: window.getComputedStyle(element).getPropertyValue('font-weight'),
        pcNumerical: text.length && percentageNumerical(text),
        hasDigit: hasDigit,
        hasDigitCurrency: hasDigitCurrency,
        textWidth: textWidth,
        textHeight: textHeight,
        textLength: text.length,
        t_r: red,
        t_g: green,
        t_b: blue,
        label: label,
    };
}

visibleElementsArray.forEach(function (element) {
    let metadata = get_element_metadata(element);
    if(metadata) {
        size_pos.push(metadata);
    }
});


// Inject the current one set in the include_filters, which may be a CSS rule
// used for displaying the current one in VisualSelector, where its not one we generated.
if (include_filters.length) {
    let results;
    // Foreach filter, go and find it on the page and add it to the results so we can visualise it again
    outerLoop:
    for (const f of include_filters) {
        // Quick check so we dont end up with duplicates in the training data
        for (let index = 0; index < size_pos.length; index++) {
            let item = size_pos[index];
            if (item.xpath === f) {
                item.highlight_as_custom_filter = true;
                item.found_as_duplicate = true;
                item.label = "price";
                continue outerLoop;
            }
        }

        bbox = false;
        q = false;

        if (!f.length) {
            console.log("xpath_element_scraper: Empty filter, skipping");
            continue;
        }

        try {
            // is it xpath?
            if (f.startsWith('/') || f.startsWith('xpath')) {
                var qry_f = f.replace(/xpath(:|\d:)/, '')
                console.log("[xpath] Scanning for included filter " + qry_f)
                let xpathResult = document.evaluate(qry_f, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                results = [];
                for (let i = 0; i < xpathResult.snapshotLength; i++) {
                    results.push(xpathResult.snapshotItem(i));
                }
            } else {
                console.log("[css] Scanning for included filter " + f)
                results = document.querySelectorAll(f);
            }
        } catch (e) {
            // Maybe catch DOMException and alert?
            console.log("xpath_element_scraper: Exception selecting element from filter " + f);
            console.log(e);
        }

        if (results != null && results.length) {

            // Iterate over the results
            results.forEach(node => {
                // Try to resolve //something/text() back to its /something so we can atleast get the bounding box
                try {
                    if (typeof node.nodeName == 'string' && node.nodeName === '#text') {
                        node = node.parentElement
                    }
                } catch (e) {
                    console.log(e)
                    console.log("xpath_element_scraper: #text resolver")
                }

                // #1231 - IN the case XPath attribute filter is applied, we will have to traverse up and find the element.
                if (typeof node.getBoundingClientRect == 'function') {
                    bbox = node.getBoundingClientRect();
                    console.log("xpath_element_scraper: Got filter element, scroll from top was " + scroll_y)
                } else {
                    try {
                        // Try and see we can find its ownerElement
                        bbox = node.ownerElement.getBoundingClientRect();
                        console.log("xpath_element_scraper: Got filter by ownerElement element, scroll from top was " + scroll_y)
                    } catch (e) {
                        console.log(e)
                        console.log("xpath_element_scraper: error looking up q.ownerElement")
                    }
                }
                element_info = get_element_metadata(node);
                if(element_info) {
                    // Be sure we use exactly what was written
                    element_info['xpath'] = f;
                    element_info['highlight_as_custom_filter'] = true;
                    element_info['label'] = "price";
                    size_pos.push(element_info);
                }

            });
        }
    }
}

// Sort the elements so we find the smallest one first, in other words, we find the smallest one matching in that area
// so that we dont select the wrapping element by mistake and be unable to select what we want
size_pos.sort((a, b) => (a.width * a.height > b.width * b.height) ? 1 : -1)

// Window.width required for proper scaling in the frontend
return {'size_pos': size_pos, 'browser_width': window.innerWidth};

'format es6';
'use strict';

const name = 'GR0963GrangeCarteNoel2016';

import $ from 'jquery';
import gsap from 'greensock';
import Promise from 'Promise';

// try { require('source-map-'+'support').install(); } catch (e) { console.log('source map error', e); }

// The ns constant is created only once and is a window sub-object to 
// namespace public functions or properties throughout the app, without
// pollution the global scope.
const ns = window[name] = (window[name] || {});

/**
 * Gets the body element
 *
 * @return {jQuery} body
 */
export const getBody = (() => {
	let body;
	return () => {
		body = body || $('body');
		return body;
	};
})();


/**
 *  Get a unique ID, prefixed with "uid"
 * 
 * @return {String}
 */
export const getUniqueID = (() => {
	let id = 0;
	return () => `uid${id++}`;
})();

/**
 * Wrapper for the $(document).ready() function to be a then-able
 * object.
 * 
 * @Promise {Function}
 * 
 * @return {Promise}
 */
export const docReady = (() => {
	return new Promise((resolve, reject) => {
		$(document).ready(resolve);
	});
})();

/**
 * Check if the viewport width is smaller or equal to a treshold
 *
 * @param {Number} treshold
 * 
 * @return {Boolean}
 */
export const isMobile = (treshold = 1279) => $(window).width() <= treshold;

/**
 * Scrolls to an element position using TweenMax. If an offset is 
 * defined, scrolls that amount higher than the target element.
 *
 * @param {jQuery Object | DOM Node} el
 * @param {Number} offset
 */
export const scrollToElem = (el, offset = 0) => {
	const $el = $(el);
	const st = $(window).scrollTop();
	const scroll = {
		y: st,
	};

	gsap.TweenMax.to(scroll, 1.2, {
		y: $el.offset().top + offset,
		ease: gsap.Cubic.easeInOut,
		onUpdate: () => {
			$(window).scrollTop(scroll.y);
		},
	});
};

/**
 * Takes an array as a param, shuffles it and returns it. Does not
 * create a new array.
 *
 * @param {Array} array
 * 
 * @return {Array} array
 */
export const shuffleArray = (array) => {
	for (let i = array.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const temp = array[i];
		array[i] = array[j];
		array[j] = temp;
	}
	return array;
};

export default ns;

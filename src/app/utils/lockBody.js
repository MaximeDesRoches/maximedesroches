'format es6';
'use strict';

let scrollTop = 0;

/* SCSS for locked
 	body.locked {
		position: fixed;
		overflow: hidden;
		height: 100%;
	}
*/

import $ from 'jquery';

export const lockBody = () => {
	scrollTop = $(window).scrollTop();
	document.body.classList.add('locked');
	document.body.style.top = `${-scrollTop}px`;
};

export const unlockBody = () => {
	document.body.classList.remove('locked');
	document.body.style.top = '';
	$(window).scrollTop(scrollTop);
};

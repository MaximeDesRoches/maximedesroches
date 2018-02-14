'format es6';
'use strict';

import Promise from 'promise';
import gsap, { TweenMax } from 'gsap';
import DrawSVG from './utils/DrawSVG.min';
import { isIE } from './utils/ieDetect';

import { Step, ENDED } from './Step';

const SVG_NS = 'http://www.w3.org/2000/svg';

function makeCircle(cx, cy, r) {
	return `
		M ${cx} ${cy}
		m ${-r}, 0
		a ${r},${r} 0 1,0 ${(r * 2)},0
		a ${r},${r} 0 1,0 ${-(r * 2)},0
	`;
}

class Button {
	constructor(data) {
		this.data = data;
		
		this.node = document.createElementNS(SVG_NS, 'path');
		this.node.__btn = this;
		this.node.setAttributeNS(null, 'd', makeCircle(data.x, data.y, data.r));
		this.node.setAttributeNS(null, 'stroke', `rgba(255,255,255,${data.opacity})`);
		this.node.setAttributeNS(null, 'fill', 'rgba(255,255,255,0)');
		this.node.setAttributeNS(null, 'stroke-width', 8);

		this.label = document.createElementNS(SVG_NS, 'text');
		this.label.textContent = data.text_fr;

		if (data.label_pos === 'top') {
			this.label.setAttributeNS(null, 'x', data.x);
			this.label.setAttributeNS(null, 'y', data.y - data.r - 30);
			this.label.setAttributeNS(null, 'text-anchor', 'middle');
		} else {
			this.label.setAttributeNS(null, 'x', data.x + data.r + 30);
			this.label.setAttributeNS(null, 'y', data.y);
			this.label.setAttributeNS(null, 'text-anchor', 'start');
		}

		this.node.style.transformOrigin = `50% 50%`;
		// TweenMax.set(this.node, { scale: 1, 'transform-origin':  });
	}

	animateIn(delay) {
		if (!isIE) {
			TweenMax.from(this.node, 0.6, { drawSVG: '0%', ease: gsap.Sine.easeInOut, delay });
		} else {
			TweenMax.from(this.node, 0.3, { opacity: 0, ease: gsap.Sine.easeOut, delay });
		}
	}

	attach(ctn) {
		ctn.appendChild(this.node);
		ctn.appendChild(this.label);
	}

	remove() {
		this.video.pause();
		this.node.parentNode.removeChild(this.node);
		this.label.parentNode.removeChild(this.label);
	}

	isGood = () => this.data.is_good;
}

function svgRemoveClass(elem, className) {
	if (elem.classList) {
		elem.classList.remove(className);
	} else {
		const c = elem.getAttribute('class');
		elem.setAttribute('class', c.replace(className, '').trim());
	}
}

function svgAddClass(elem, className) {
	if (elem.classList) {
		elem.classList.add(className);
	} else {
		const c = elem.getAttribute('class');
		elem.setAttribute('class', `${c} ${className}`);
	}
}

export class InteractiveVideo extends Step {
	constructor(infos) {
		super(infos);
		this.video.loop = true;
	}
	
	videoPromise = (state = 'success') => {
		this.dispatchEvent({ type: ENDED, state });
	}

	setListeners() {
		this.onEnded = new Promise((resolve) => {
			this.endedResolve = resolve;
		});
	}

	onClickButton = (e) => {
		const clickedButton = e.currentTarget;

		let index = -1;
		this.clickedButtons.some((button, i) => {
			if (button === clickedButton.__btn) {
				index = i;
				return true;
			}
			return false;
		});
		const id = index;
		if (id >= 0) {
			svgRemoveClass(clickedButton, 'selected');
			this.clickedButtons.splice(id, 1);
		} else {
			this.clickedButtons.push(clickedButton.__btn);
			svgAddClass(clickedButton, 'selected');
		}

		if (this.clickedButtons.length === this.goodButtons.length) {
			const validate = this.goodButtons.filter(button => this.clickedButtons.find(btn => btn === button));
			// this.onEnded();
			this.endedResolve(validate.length === this.goodButtons.length ? 'success' : 'fail');
		}
	}
	
	start = () => {
		this.setListeners();
		this.video.currentTime = 0;
		this.video.setAttribute('preload', 'preload');
		this.video.setAttribute('autoplay', 'autoplay');
		this.video.play();

		this.caption = document.createElement('div');
		this.caption.classList.add('caption');
		this.caption.classList.add(this.description_position);
		this.caption.innerHTML = this.description;
		this.node.appendChild(this.caption);

		this.svg = document.createElementNS(SVG_NS, 'svg');
		this.svg.setAttributeNS(null, 'viewBox', '0 0 1920 1080');
		TweenMax.set(this.svg, {
			position: 'absolute',
			top: 0,
			left: 0,
			width: '100%',
			height: '100%',
		});

		this.node.appendChild(this.svg);

		this.goodButtons = [];
		this.clickedButtons = [];
		this.buttons = [];
		this.choices.forEach((choice, i) => {
			const btn = new Button(choice);

			btn.node.addEventListener('click', this.onClickButton);

			btn.attach(this.svg);
			btn.animateIn(1 + (i * 0.1));

			if (btn.isGood()) {
				this.goodButtons.push(btn);
			}
		});
	}

	remove() {
		this.removeListeners();
		this.buttons.forEach((btn) => {
			btn.node.removeEventListener('click', this.onClickButton);
			btn.remove();
		});
		this.svg.parentNode.removeChild(this.svg);
		this.node.parentNode.removeChild(this.node);
	}
}

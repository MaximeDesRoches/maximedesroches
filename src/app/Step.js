'format es6';
'use strict';

import EventDispatcher from './utils/EventDispatcher';

export const ENDED = 'step_ended';

export const VIDEO = 'video';
export const INTERACTIVE = 'interactive';

export class Step extends EventDispatcher {
	infosToProps(infos) {
		Object.keys(infos).forEach((k) => {
			this[k] = infos[k];
		});
	}

	onClickPlayPause = () => {
		this.playPause.classList.toggle('playing');

		if (this.playPause.classList.contains('playing')) {
			this.video.play();
		} else {
			this.video.pause();
		}
	}
	
	constructor(infos) {
		super();
		
		this.infosToProps(infos);

		this.node = document.createElement('div');
		this.node.classList.add('ctn-step');

		this.video = document.createElement('video');

		const prefix = ~window.location.href.indexOf('workspace') ? 'videos/' : 'https://s3.amazonaws.com/arcelor-security-videos/';

		this.video.src = prefix + this.video_src;
		// this.video.playbackRate = 3.0;
		this.video.setAttribute('webkit-playsinline', 'webkit-playsinline');
		this.video.setAttribute('playsinline', 'playsinline');
		this.video.preload = 'none';
		this.node.appendChild(this.video);

		this.playPause = document.createElement('div');
		this.playPause.classList.add('play-pause', 'playing');
		this.node.appendChild(this.playPause);

		this.playPause.removeEventListener('click', this.onClickPlayPause);
		this.playPause.addEventListener('click', this.onClickPlayPause);

		this.init();
	}

	init() {}
	setListeners() {}
	start() {}
	remove() {}

	preattach = (el, hidden = false) => {
		console.log('pre-attaching', this.slug);
		el.appendChild(this.node);
		this.node.classList[hidden ? 'add' : 'remove']('inactive');
	}

	attach(el) {
		this.preattach(el);
		this.start();
	}
}

'format es6';
'use strict';

import Promise from 'promise';
import { Step, ENDED } from './Step';

export const VIDEO_ENDED = 'video_ended';

export class LinearVideo extends Step {
	videoPromise = () => {
		this.endedResolve();
	}

	setListeners() {
		this.onEnded = new Promise((resolve) => {
			this.endedResolve = resolve;
			this.video.addEventListener('ended', this.videoPromise);
		});
	}
	
	start() {
		this.setListeners();
		this.video.currentTime = 0;
		this.video.setAttribute('preload', 'preload');
		this.video.setAttribute('autoplay', 'autoplay');
		this.video.play();
	}

	remove() {
		this.removeListeners();
		this.video.removeEventListener('ended', this.videoPromise);

		if (this.node.parentNode) {
			this.node.parentNode.removeChild(this.node);
		}
	}
}

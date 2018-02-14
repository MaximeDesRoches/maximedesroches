'format es6';
'use strict';

import 'babel-polyfill';
import { TweenMax } from 'gsap';
import Promise from 'promise';
import $ from 'jquery';
import { Step, VIDEO, INTERACTIVE, ENDED } from './Step';
import { LinearVideo } from './LinearVideo';
import { InteractiveVideo } from './InteractiveVideo';

$(document).ready(() => {
	const app = document.querySelector('#app');
	const startApp = document.querySelector('#startApp');
	const volume = document.querySelector('#volume');
	const startUI = document.querySelector('.start-ui');

	const styles = document.createElement('style');
	app.appendChild(styles);
	styles.innerHTML = '';

	const steps = [];

	let currentStep = null;

	function getStepBySlug(slug) {
		return steps.find(step => step.slug === slug);
	}
	
	function preloadNextSteps(step) {
		const nextSteps = [
			getStepBySlug(step.next),
			getStepBySlug(step.success),
			getStepBySlug(step.fail),
		];

		nextSteps.filter(s => s).forEach((s) => {
			console.log('preloading', s.slug);
			const canplay = () => {
				s.video.removeEventListener('canplay', canplay);
			};
			s.video.addEventListener('canplay', canplay);
			s.video.preload = 'auto';
			s.preattach(app, true);
		});
	}

	function manageVolume() {
		volume.classList.toggle('muted');
		const isMuted = volume.classList.contains('muted');
		steps.forEach((s) => {
			s.video.muted = isMuted;
		});
	}

	function onResize() {
		const width = window.innerWidth
			|| document.documentElement.clientWidth
			|| document.body.clientWidth;

		const height = window.innerHeight
			|| document.documentElement.clientHeight
			|| document.body.clientHeight;

		let computedWidth = width;
		let computedMargin = 0;

		if (height < width / 16 * 9) {
			computedWidth = height / 9 * 16;
			computedMargin = (width - computedWidth) / 2;
		}

		styles.innerHTML = `.ctn-step { 
			width: ${computedWidth}px;
			margin-left: ${computedMargin}px;
		}`;
	}
	
	function doStep(step) {
		step.attach(app);
		currentStep = step;

		step.onEnded.then((e = null) => {
			step.remove();
			let nextId = step.next;
			if (e) {
				nextId = step[e];
			}
			const next = getStepBySlug(nextId);
			if (!next) {
				//alert('end');
				window.location.href = 'http://canada.arcelormittal.com/';
			} else {
				doStep(next);
			}
		}).catch((e) => {
			console.log(e);
			console.trace();
		});

		preloadNextSteps(step);
	}

	function onStart() {
		doStep(steps[0]);
		TweenMax.set(startUI, { display: 'none' });
		TweenMax.set(volume, { display: '' });
	}

	TweenMax.set(startUI, { display: 'none' });
	TweenMax.set(volume, { display: 'none' });

	$.ajax({
		url: './js/manifest.json',
		success: (data) => {
			data.forEach((step) => {
				switch (step.type) {
				default:
				case VIDEO:
					steps.push(new LinearVideo(step));
					break;
				case INTERACTIVE:
					steps.push(new InteractiveVideo(step));
					break;
				}
			});
			TweenMax.set(startUI, { display: '' });
		},
	});
	
	document.addEventListener('keypress', (e) => {
		if (currentStep && (e.keyCode === 32 || e.which === 32)) {
			currentStep.video.currentTime = currentStep.video.duration - 2.5 || currentStep.video.currentTime;
		}
	});
	
	window.addEventListener('resize', onResize);
	onResize();
	startApp.addEventListener('click', onStart);
	volume.addEventListener('click', manageVolume);
});

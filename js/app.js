(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
"use strict";

// rawAsap provides everything we need except exception management.
var rawAsap = require("./raw");
// RawTasks are recycled to reduce GC churn.
var freeTasks = [];
// We queue errors to ensure they are thrown in right order (FIFO).
// Array-as-queue is good enough here, since we are just dealing with exceptions.
var pendingErrors = [];
var requestErrorThrow = rawAsap.makeRequestCallFromTimer(throwFirstError);

function throwFirstError() {
    if (pendingErrors.length) {
        throw pendingErrors.shift();
    }
}

/**
 * Calls a task as soon as possible after returning, in its own event, with priority
 * over other events like animation, reflow, and repaint. An error thrown from an
 * event will not interrupt, nor even substantially slow down the processing of
 * other events, but will be rather postponed to a lower priority event.
 * @param {{call}} task A callable object, typically a function that takes no
 * arguments.
 */
module.exports = asap;
function asap(task) {
    var rawTask;
    if (freeTasks.length) {
        rawTask = freeTasks.pop();
    } else {
        rawTask = new RawTask();
    }
    rawTask.task = task;
    rawAsap(rawTask);
}

// We wrap tasks with recyclable task objects.  A task object implements
// `call`, just like a function.
function RawTask() {
    this.task = null;
}

// The sole purpose of wrapping the task is to catch the exception and recycle
// the task object after its single use.
RawTask.prototype.call = function () {
    try {
        this.task.call();
    } catch (error) {
        if (asap.onerror) {
            // This hook exists purely for testing purposes.
            // Its name will be periodically randomized to break any code that
            // depends on its existence.
            asap.onerror(error);
        } else {
            // In a web browser, exceptions are not fatal. However, to avoid
            // slowing down the queue of pending tasks, we rethrow the error in a
            // lower priority turn.
            pendingErrors.push(error);
            requestErrorThrow();
        }
    } finally {
        this.task = null;
        freeTasks[freeTasks.length] = this;
    }
};

},{"./raw":2}],2:[function(require,module,exports){
(function (global){
"use strict";

// Use the fastest means possible to execute a task in its own turn, with
// priority over other events including IO, animation, reflow, and redraw
// events in browsers.
//
// An exception thrown by a task will permanently interrupt the processing of
// subsequent tasks. The higher level `asap` function ensures that if an
// exception is thrown by a task, that the task queue will continue flushing as
// soon as possible, but if you use `rawAsap` directly, you are responsible to
// either ensure that no exceptions are thrown from your task, or to manually
// call `rawAsap.requestFlush` if an exception is thrown.
module.exports = rawAsap;
function rawAsap(task) {
    if (!queue.length) {
        requestFlush();
        flushing = true;
    }
    // Equivalent to push, but avoids a function call.
    queue[queue.length] = task;
}

var queue = [];
// Once a flush has been requested, no further calls to `requestFlush` are
// necessary until the next `flush` completes.
var flushing = false;
// `requestFlush` is an implementation-specific method that attempts to kick
// off a `flush` event as quickly as possible. `flush` will attempt to exhaust
// the event queue before yielding to the browser's own event loop.
var requestFlush;
// The position of the next task to execute in the task queue. This is
// preserved between calls to `flush` so that it can be resumed if
// a task throws an exception.
var index = 0;
// If a task schedules additional tasks recursively, the task queue can grow
// unbounded. To prevent memory exhaustion, the task queue will periodically
// truncate already-completed tasks.
var capacity = 1024;

// The flush function processes all tasks that have been scheduled with
// `rawAsap` unless and until one of those tasks throws an exception.
// If a task throws an exception, `flush` ensures that its state will remain
// consistent and will resume where it left off when called again.
// However, `flush` does not make any arrangements to be called again if an
// exception is thrown.
function flush() {
    while (index < queue.length) {
        var currentIndex = index;
        // Advance the index before calling the task. This ensures that we will
        // begin flushing on the next task the task throws an error.
        index = index + 1;
        queue[currentIndex].call();
        // Prevent leaking memory for long chains of recursive calls to `asap`.
        // If we call `asap` within tasks scheduled by `asap`, the queue will
        // grow, but to avoid an O(n) walk for every task we execute, we don't
        // shift tasks off the queue after they have been executed.
        // Instead, we periodically shift 1024 tasks off the queue.
        if (index > capacity) {
            // Manually shift all values starting at the index back to the
            // beginning of the queue.
            for (var scan = 0, newLength = queue.length - index; scan < newLength; scan++) {
                queue[scan] = queue[scan + index];
            }
            queue.length -= index;
            index = 0;
        }
    }
    queue.length = 0;
    index = 0;
    flushing = false;
}

// `requestFlush` is implemented using a strategy based on data collected from
// every available SauceLabs Selenium web driver worker at time of writing.
// https://docs.google.com/spreadsheets/d/1mG-5UYGup5qxGdEMWkhP6BWCz053NUb2E1QoUTU16uA/edit#gid=783724593

// Safari 6 and 6.1 for desktop, iPad, and iPhone are the only browsers that
// have WebKitMutationObserver but not un-prefixed MutationObserver.
// Must use `global` or `self` instead of `window` to work in both frames and web
// workers. `global` is a provision of Browserify, Mr, Mrs, or Mop.

/* globals self */
var scope = typeof global !== "undefined" ? global : self;
var BrowserMutationObserver = scope.MutationObserver || scope.WebKitMutationObserver;

// MutationObservers are desirable because they have high priority and work
// reliably everywhere they are implemented.
// They are implemented in all modern browsers.
//
// - Android 4-4.3
// - Chrome 26-34
// - Firefox 14-29
// - Internet Explorer 11
// - iPad Safari 6-7.1
// - iPhone Safari 7-7.1
// - Safari 6-7
if (typeof BrowserMutationObserver === "function") {
    requestFlush = makeRequestCallFromMutationObserver(flush);

// MessageChannels are desirable because they give direct access to the HTML
// task queue, are implemented in Internet Explorer 10, Safari 5.0-1, and Opera
// 11-12, and in web workers in many engines.
// Although message channels yield to any queued rendering and IO tasks, they
// would be better than imposing the 4ms delay of timers.
// However, they do not work reliably in Internet Explorer or Safari.

// Internet Explorer 10 is the only browser that has setImmediate but does
// not have MutationObservers.
// Although setImmediate yields to the browser's renderer, it would be
// preferrable to falling back to setTimeout since it does not have
// the minimum 4ms penalty.
// Unfortunately there appears to be a bug in Internet Explorer 10 Mobile (and
// Desktop to a lesser extent) that renders both setImmediate and
// MessageChannel useless for the purposes of ASAP.
// https://github.com/kriskowal/q/issues/396

// Timers are implemented universally.
// We fall back to timers in workers in most engines, and in foreground
// contexts in the following browsers.
// However, note that even this simple case requires nuances to operate in a
// broad spectrum of browsers.
//
// - Firefox 3-13
// - Internet Explorer 6-9
// - iPad Safari 4.3
// - Lynx 2.8.7
} else {
    requestFlush = makeRequestCallFromTimer(flush);
}

// `requestFlush` requests that the high priority event queue be flushed as
// soon as possible.
// This is useful to prevent an error thrown in a task from stalling the event
// queue if the exception handled by Node.js’s
// `process.on("uncaughtException")` or by a domain.
rawAsap.requestFlush = requestFlush;

// To request a high priority event, we induce a mutation observer by toggling
// the text of a text node between "1" and "-1".
function makeRequestCallFromMutationObserver(callback) {
    var toggle = 1;
    var observer = new BrowserMutationObserver(callback);
    var node = document.createTextNode("");
    observer.observe(node, {characterData: true});
    return function requestCall() {
        toggle = -toggle;
        node.data = toggle;
    };
}

// The message channel technique was discovered by Malte Ubl and was the
// original foundation for this library.
// http://www.nonblocking.io/2011/06/windownexttick.html

// Safari 6.0.5 (at least) intermittently fails to create message ports on a
// page's first load. Thankfully, this version of Safari supports
// MutationObservers, so we don't need to fall back in that case.

// function makeRequestCallFromMessageChannel(callback) {
//     var channel = new MessageChannel();
//     channel.port1.onmessage = callback;
//     return function requestCall() {
//         channel.port2.postMessage(0);
//     };
// }

// For reasons explained above, we are also unable to use `setImmediate`
// under any circumstances.
// Even if we were, there is another bug in Internet Explorer 10.
// It is not sufficient to assign `setImmediate` to `requestFlush` because
// `setImmediate` must be called *by name* and therefore must be wrapped in a
// closure.
// Never forget.

// function makeRequestCallFromSetImmediate(callback) {
//     return function requestCall() {
//         setImmediate(callback);
//     };
// }

// Safari 6.0 has a problem where timers will get lost while the user is
// scrolling. This problem does not impact ASAP because Safari 6.0 supports
// mutation observers, so that implementation is used instead.
// However, if we ever elect to use timers in Safari, the prevalent work-around
// is to add a scroll event listener that calls for a flush.

// `setTimeout` does not call the passed callback if the delay is less than
// approximately 7 in web workers in Firefox 8 through 18, and sometimes not
// even then.

function makeRequestCallFromTimer(callback) {
    return function requestCall() {
        // We dispatch a timeout with a specified delay of 0 for engines that
        // can reliably accommodate that request. This will usually be snapped
        // to a 4 milisecond delay, but once we're flushing, there's no delay
        // between events.
        var timeoutHandle = setTimeout(handleTimer, 0);
        // However, since this timer gets frequently dropped in Firefox
        // workers, we enlist an interval handle that will try to fire
        // an event 20 times per second until it succeeds.
        var intervalHandle = setInterval(handleTimer, 50);

        function handleTimer() {
            // Whichever timer succeeds will cancel both timers and
            // execute the callback.
            clearTimeout(timeoutHandle);
            clearInterval(intervalHandle);
            callback();
        }
    };
}

// This is for `asap.js` only.
// Its name will be periodically randomized to break any code that depends on
// its existence.
rawAsap.makeRequestCallFromTimer = makeRequestCallFromTimer;

// ASAP was originally a nextTick shim included in Q. This was factored out
// into this ASAP package. It was later adapted to RSVP which made further
// amendments. These decisions, particularly to marginalize MessageChannel and
// to capture the MutationObserver implementation in a closure, were integrated
// back into ASAP proper.
// https://github.com/tildeio/rsvp.js/blob/cddf7232546a9cf858524b75cde6f9edf72620a7/lib/rsvp/asap.js

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],3:[function(require,module,exports){
'use strict';

module.exports = require('./lib')

},{"./lib":8}],4:[function(require,module,exports){
'use strict';

var asap = require('asap/raw');

function noop() {}

// States:
//
// 0 - pending
// 1 - fulfilled with _value
// 2 - rejected with _value
// 3 - adopted the state of another promise, _value
//
// once the state is no longer pending (0) it is immutable

// All `_` prefixed properties will be reduced to `_{random number}`
// at build time to obfuscate them and discourage their use.
// We don't use symbols or Object.defineProperty to fully hide them
// because the performance isn't good enough.


// to avoid using try/catch inside critical functions, we
// extract them to here.
var LAST_ERROR = null;
var IS_ERROR = {};
function getThen(obj) {
  try {
    return obj.then;
  } catch (ex) {
    LAST_ERROR = ex;
    return IS_ERROR;
  }
}

function tryCallOne(fn, a) {
  try {
    return fn(a);
  } catch (ex) {
    LAST_ERROR = ex;
    return IS_ERROR;
  }
}
function tryCallTwo(fn, a, b) {
  try {
    fn(a, b);
  } catch (ex) {
    LAST_ERROR = ex;
    return IS_ERROR;
  }
}

module.exports = Promise;

function Promise(fn) {
  if (typeof this !== 'object') {
    throw new TypeError('Promises must be constructed via new');
  }
  if (typeof fn !== 'function') {
    throw new TypeError('Promise constructor\'s argument is not a function');
  }
  this._75 = 0;
  this._83 = 0;
  this._18 = null;
  this._38 = null;
  if (fn === noop) return;
  doResolve(fn, this);
}
Promise._47 = null;
Promise._71 = null;
Promise._44 = noop;

Promise.prototype.then = function(onFulfilled, onRejected) {
  if (this.constructor !== Promise) {
    return safeThen(this, onFulfilled, onRejected);
  }
  var res = new Promise(noop);
  handle(this, new Handler(onFulfilled, onRejected, res));
  return res;
};

function safeThen(self, onFulfilled, onRejected) {
  return new self.constructor(function (resolve, reject) {
    var res = new Promise(noop);
    res.then(resolve, reject);
    handle(self, new Handler(onFulfilled, onRejected, res));
  });
}
function handle(self, deferred) {
  while (self._83 === 3) {
    self = self._18;
  }
  if (Promise._47) {
    Promise._47(self);
  }
  if (self._83 === 0) {
    if (self._75 === 0) {
      self._75 = 1;
      self._38 = deferred;
      return;
    }
    if (self._75 === 1) {
      self._75 = 2;
      self._38 = [self._38, deferred];
      return;
    }
    self._38.push(deferred);
    return;
  }
  handleResolved(self, deferred);
}

function handleResolved(self, deferred) {
  asap(function() {
    var cb = self._83 === 1 ? deferred.onFulfilled : deferred.onRejected;
    if (cb === null) {
      if (self._83 === 1) {
        resolve(deferred.promise, self._18);
      } else {
        reject(deferred.promise, self._18);
      }
      return;
    }
    var ret = tryCallOne(cb, self._18);
    if (ret === IS_ERROR) {
      reject(deferred.promise, LAST_ERROR);
    } else {
      resolve(deferred.promise, ret);
    }
  });
}
function resolve(self, newValue) {
  // Promise Resolution Procedure: https://github.com/promises-aplus/promises-spec#the-promise-resolution-procedure
  if (newValue === self) {
    return reject(
      self,
      new TypeError('A promise cannot be resolved with itself.')
    );
  }
  if (
    newValue &&
    (typeof newValue === 'object' || typeof newValue === 'function')
  ) {
    var then = getThen(newValue);
    if (then === IS_ERROR) {
      return reject(self, LAST_ERROR);
    }
    if (
      then === self.then &&
      newValue instanceof Promise
    ) {
      self._83 = 3;
      self._18 = newValue;
      finale(self);
      return;
    } else if (typeof then === 'function') {
      doResolve(then.bind(newValue), self);
      return;
    }
  }
  self._83 = 1;
  self._18 = newValue;
  finale(self);
}

function reject(self, newValue) {
  self._83 = 2;
  self._18 = newValue;
  if (Promise._71) {
    Promise._71(self, newValue);
  }
  finale(self);
}
function finale(self) {
  if (self._75 === 1) {
    handle(self, self._38);
    self._38 = null;
  }
  if (self._75 === 2) {
    for (var i = 0; i < self._38.length; i++) {
      handle(self, self._38[i]);
    }
    self._38 = null;
  }
}

function Handler(onFulfilled, onRejected, promise){
  this.onFulfilled = typeof onFulfilled === 'function' ? onFulfilled : null;
  this.onRejected = typeof onRejected === 'function' ? onRejected : null;
  this.promise = promise;
}

/**
 * Take a potentially misbehaving resolver function and make sure
 * onFulfilled and onRejected are only called once.
 *
 * Makes no guarantees about asynchrony.
 */
function doResolve(fn, promise) {
  var done = false;
  var res = tryCallTwo(fn, function (value) {
    if (done) return;
    done = true;
    resolve(promise, value);
  }, function (reason) {
    if (done) return;
    done = true;
    reject(promise, reason);
  });
  if (!done && res === IS_ERROR) {
    done = true;
    reject(promise, LAST_ERROR);
  }
}

},{"asap/raw":2}],5:[function(require,module,exports){
'use strict';

var Promise = require('./core.js');

module.exports = Promise;
Promise.prototype.done = function (onFulfilled, onRejected) {
  var self = arguments.length ? this.then.apply(this, arguments) : this;
  self.then(null, function (err) {
    setTimeout(function () {
      throw err;
    }, 0);
  });
};

},{"./core.js":4}],6:[function(require,module,exports){
'use strict';

//This file contains the ES6 extensions to the core Promises/A+ API

var Promise = require('./core.js');

module.exports = Promise;

/* Static Functions */

var TRUE = valuePromise(true);
var FALSE = valuePromise(false);
var NULL = valuePromise(null);
var UNDEFINED = valuePromise(undefined);
var ZERO = valuePromise(0);
var EMPTYSTRING = valuePromise('');

function valuePromise(value) {
  var p = new Promise(Promise._44);
  p._83 = 1;
  p._18 = value;
  return p;
}
Promise.resolve = function (value) {
  if (value instanceof Promise) return value;

  if (value === null) return NULL;
  if (value === undefined) return UNDEFINED;
  if (value === true) return TRUE;
  if (value === false) return FALSE;
  if (value === 0) return ZERO;
  if (value === '') return EMPTYSTRING;

  if (typeof value === 'object' || typeof value === 'function') {
    try {
      var then = value.then;
      if (typeof then === 'function') {
        return new Promise(then.bind(value));
      }
    } catch (ex) {
      return new Promise(function (resolve, reject) {
        reject(ex);
      });
    }
  }
  return valuePromise(value);
};

Promise.all = function (arr) {
  var args = Array.prototype.slice.call(arr);

  return new Promise(function (resolve, reject) {
    if (args.length === 0) return resolve([]);
    var remaining = args.length;
    function res(i, val) {
      if (val && (typeof val === 'object' || typeof val === 'function')) {
        if (val instanceof Promise && val.then === Promise.prototype.then) {
          while (val._83 === 3) {
            val = val._18;
          }
          if (val._83 === 1) return res(i, val._18);
          if (val._83 === 2) reject(val._18);
          val.then(function (val) {
            res(i, val);
          }, reject);
          return;
        } else {
          var then = val.then;
          if (typeof then === 'function') {
            var p = new Promise(then.bind(val));
            p.then(function (val) {
              res(i, val);
            }, reject);
            return;
          }
        }
      }
      args[i] = val;
      if (--remaining === 0) {
        resolve(args);
      }
    }
    for (var i = 0; i < args.length; i++) {
      res(i, args[i]);
    }
  });
};

Promise.reject = function (value) {
  return new Promise(function (resolve, reject) {
    reject(value);
  });
};

Promise.race = function (values) {
  return new Promise(function (resolve, reject) {
    values.forEach(function(value){
      Promise.resolve(value).then(resolve, reject);
    });
  });
};

/* Prototype Methods */

Promise.prototype['catch'] = function (onRejected) {
  return this.then(null, onRejected);
};

},{"./core.js":4}],7:[function(require,module,exports){
'use strict';

var Promise = require('./core.js');

module.exports = Promise;
Promise.prototype['finally'] = function (f) {
  return this.then(function (value) {
    return Promise.resolve(f()).then(function () {
      return value;
    });
  }, function (err) {
    return Promise.resolve(f()).then(function () {
      throw err;
    });
  });
};

},{"./core.js":4}],8:[function(require,module,exports){
'use strict';

module.exports = require('./core.js');
require('./done.js');
require('./finally.js');
require('./es6-extensions.js');
require('./node-extensions.js');
require('./synchronous.js');

},{"./core.js":4,"./done.js":5,"./es6-extensions.js":6,"./finally.js":7,"./node-extensions.js":9,"./synchronous.js":10}],9:[function(require,module,exports){
'use strict';

// This file contains then/promise specific extensions that are only useful
// for node.js interop

var Promise = require('./core.js');
var asap = require('asap');

module.exports = Promise;

/* Static Functions */

Promise.denodeify = function (fn, argumentCount) {
  if (
    typeof argumentCount === 'number' && argumentCount !== Infinity
  ) {
    return denodeifyWithCount(fn, argumentCount);
  } else {
    return denodeifyWithoutCount(fn);
  }
};

var callbackFn = (
  'function (err, res) {' +
  'if (err) { rj(err); } else { rs(res); }' +
  '}'
);
function denodeifyWithCount(fn, argumentCount) {
  var args = [];
  for (var i = 0; i < argumentCount; i++) {
    args.push('a' + i);
  }
  var body = [
    'return function (' + args.join(',') + ') {',
    'var self = this;',
    'return new Promise(function (rs, rj) {',
    'var res = fn.call(',
    ['self'].concat(args).concat([callbackFn]).join(','),
    ');',
    'if (res &&',
    '(typeof res === "object" || typeof res === "function") &&',
    'typeof res.then === "function"',
    ') {rs(res);}',
    '});',
    '};'
  ].join('');
  return Function(['Promise', 'fn'], body)(Promise, fn);
}
function denodeifyWithoutCount(fn) {
  var fnLength = Math.max(fn.length - 1, 3);
  var args = [];
  for (var i = 0; i < fnLength; i++) {
    args.push('a' + i);
  }
  var body = [
    'return function (' + args.join(',') + ') {',
    'var self = this;',
    'var args;',
    'var argLength = arguments.length;',
    'if (arguments.length > ' + fnLength + ') {',
    'args = new Array(arguments.length + 1);',
    'for (var i = 0; i < arguments.length; i++) {',
    'args[i] = arguments[i];',
    '}',
    '}',
    'return new Promise(function (rs, rj) {',
    'var cb = ' + callbackFn + ';',
    'var res;',
    'switch (argLength) {',
    args.concat(['extra']).map(function (_, index) {
      return (
        'case ' + (index) + ':' +
        'res = fn.call(' + ['self'].concat(args.slice(0, index)).concat('cb').join(',') + ');' +
        'break;'
      );
    }).join(''),
    'default:',
    'args[argLength] = cb;',
    'res = fn.apply(self, args);',
    '}',
    
    'if (res &&',
    '(typeof res === "object" || typeof res === "function") &&',
    'typeof res.then === "function"',
    ') {rs(res);}',
    '});',
    '};'
  ].join('');

  return Function(
    ['Promise', 'fn'],
    body
  )(Promise, fn);
}

Promise.nodeify = function (fn) {
  return function () {
    var args = Array.prototype.slice.call(arguments);
    var callback =
      typeof args[args.length - 1] === 'function' ? args.pop() : null;
    var ctx = this;
    try {
      return fn.apply(this, arguments).nodeify(callback, ctx);
    } catch (ex) {
      if (callback === null || typeof callback == 'undefined') {
        return new Promise(function (resolve, reject) {
          reject(ex);
        });
      } else {
        asap(function () {
          callback.call(ctx, ex);
        })
      }
    }
  }
};

Promise.prototype.nodeify = function (callback, ctx) {
  if (typeof callback != 'function') return this;

  this.then(function (value) {
    asap(function () {
      callback.call(ctx, null, value);
    });
  }, function (err) {
    asap(function () {
      callback.call(ctx, err);
    });
  });
};

},{"./core.js":4,"asap":1}],10:[function(require,module,exports){
'use strict';

var Promise = require('./core.js');

module.exports = Promise;
Promise.enableSynchronous = function () {
  Promise.prototype.isPending = function() {
    return this.getState() == 0;
  };

  Promise.prototype.isFulfilled = function() {
    return this.getState() == 1;
  };

  Promise.prototype.isRejected = function() {
    return this.getState() == 2;
  };

  Promise.prototype.getValue = function () {
    if (this._83 === 3) {
      return this._18.getValue();
    }

    if (!this.isFulfilled()) {
      throw new Error('Cannot get a value of an unfulfilled promise.');
    }

    return this._18;
  };

  Promise.prototype.getReason = function () {
    if (this._83 === 3) {
      return this._18.getReason();
    }

    if (!this.isRejected()) {
      throw new Error('Cannot get a rejection reason of a non-rejected promise.');
    }

    return this._18;
  };

  Promise.prototype.getState = function () {
    if (this._83 === 3) {
      return this._18.getState();
    }
    if (this._83 === -1 || this._83 === -2) {
      return 0;
    }

    return this._83;
  };
};

Promise.disableSynchronous = function() {
  Promise.prototype.isPending = undefined;
  Promise.prototype.isFulfilled = undefined;
  Promise.prototype.isRejected = undefined;
  Promise.prototype.getValue = undefined;
  Promise.prototype.getReason = undefined;
  Promise.prototype.getState = undefined;
};

},{"./core.js":4}],11:[function(require,module,exports){
'format es6';
'use strict';

Object.defineProperty(exports, "__esModule", {
	value: true
});
exports.InteractiveVideo = undefined;

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _promise = require('promise');

var _promise2 = _interopRequireDefault(_promise);

var _gsap = require('gsap');

var _gsap2 = _interopRequireDefault(_gsap);

var _DrawSVG = require('./utils/DrawSVG.min');

var _DrawSVG2 = _interopRequireDefault(_DrawSVG);

var _ieDetect = require('./utils/ieDetect');

var _Step2 = require('./Step');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var SVG_NS = 'http://www.w3.org/2000/svg';

function makeCircle(cx, cy, r) {
	return '\n\t\tM ' + cx + ' ' + cy + '\n\t\tm ' + -r + ', 0\n\t\ta ' + r + ',' + r + ' 0 1,0 ' + r * 2 + ',0\n\t\ta ' + r + ',' + r + ' 0 1,0 ' + -(r * 2) + ',0\n\t';
}

var Button = function () {
	function Button(data) {
		var _this = this;

		_classCallCheck(this, Button);

		this.isGood = function () {
			return _this.data.is_good;
		};

		this.data = data;

		this.node = document.createElementNS(SVG_NS, 'path');
		this.node.__btn = this;
		this.node.setAttributeNS(null, 'd', makeCircle(data.x, data.y, data.r));
		this.node.setAttributeNS(null, 'stroke', 'rgba(255,255,255,' + data.opacity + ')');
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

		this.node.style.transformOrigin = '50% 50%';
		// TweenMax.set(this.node, { scale: 1, 'transform-origin':  });
	}

	_createClass(Button, [{
		key: 'animateIn',
		value: function animateIn(delay) {
			if (!_ieDetect.isIE) {
				_gsap.TweenMax.from(this.node, 0.6, { drawSVG: '0%', ease: _gsap2.default.Sine.easeInOut, delay: delay });
			} else {
				_gsap.TweenMax.from(this.node, 0.3, { opacity: 0, ease: _gsap2.default.Sine.easeOut, delay: delay });
			}
		}
	}, {
		key: 'attach',
		value: function attach(ctn) {
			ctn.appendChild(this.node);
			ctn.appendChild(this.label);
		}
	}, {
		key: 'remove',
		value: function remove() {
			this.video.pause();
			this.node.parentNode.removeChild(this.node);
			this.label.parentNode.removeChild(this.label);
		}
	}]);

	return Button;
}();

function svgRemoveClass(elem, className) {
	if (elem.classList) {
		elem.classList.remove(className);
	} else {
		var c = elem.getAttribute('class');
		elem.setAttribute('class', c.replace(className, '').trim());
	}
}

function svgAddClass(elem, className) {
	if (elem.classList) {
		elem.classList.add(className);
	} else {
		var c = elem.getAttribute('class');
		elem.setAttribute('class', c + ' ' + className);
	}
}

var InteractiveVideo = exports.InteractiveVideo = function (_Step) {
	_inherits(InteractiveVideo, _Step);

	function InteractiveVideo(infos) {
		_classCallCheck(this, InteractiveVideo);

		var _this2 = _possibleConstructorReturn(this, (InteractiveVideo.__proto__ || Object.getPrototypeOf(InteractiveVideo)).call(this, infos));

		_this2.videoPromise = function () {
			var state = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 'success';

			_this2.dispatchEvent({ type: _Step2.ENDED, state: state });
		};

		_this2.onClickButton = function (e) {
			var clickedButton = e.currentTarget;

			var index = -1;
			_this2.clickedButtons.some(function (button, i) {
				if (button === clickedButton.__btn) {
					index = i;
					return true;
				}
				return false;
			});
			var id = index;
			if (id >= 0) {
				svgRemoveClass(clickedButton, 'selected');
				_this2.clickedButtons.splice(id, 1);
			} else {
				_this2.clickedButtons.push(clickedButton.__btn);
				svgAddClass(clickedButton, 'selected');
			}

			if (_this2.clickedButtons.length === _this2.goodButtons.length) {
				var validate = _this2.goodButtons.filter(function (button) {
					return _this2.clickedButtons.find(function (btn) {
						return btn === button;
					});
				});
				// this.onEnded();
				_this2.endedResolve(validate.length === _this2.goodButtons.length ? 'success' : 'fail');
			}
		};

		_this2.start = function () {
			_this2.setListeners();
			_this2.video.currentTime = 0;
			_this2.video.setAttribute('preload', 'preload');
			_this2.video.setAttribute('autoplay', 'autoplay');
			_this2.video.play();

			_this2.caption = document.createElement('div');
			_this2.caption.classList.add('caption');
			_this2.caption.classList.add(_this2.description_position);
			_this2.caption.innerHTML = _this2.description;
			_this2.node.appendChild(_this2.caption);

			_this2.svg = document.createElementNS(SVG_NS, 'svg');
			_this2.svg.setAttributeNS(null, 'viewBox', '0 0 1920 1080');
			_gsap.TweenMax.set(_this2.svg, {
				position: 'absolute',
				top: 0,
				left: 0,
				width: '100%',
				height: '100%'
			});

			_this2.node.appendChild(_this2.svg);

			_this2.goodButtons = [];
			_this2.clickedButtons = [];
			_this2.buttons = [];
			_this2.choices.forEach(function (choice, i) {
				var btn = new Button(choice);

				btn.node.addEventListener('click', _this2.onClickButton);

				btn.attach(_this2.svg);
				btn.animateIn(1 + i * 0.1);

				if (btn.isGood()) {
					_this2.goodButtons.push(btn);
				}
			});
		};

		_this2.video.loop = true;
		return _this2;
	}

	_createClass(InteractiveVideo, [{
		key: 'setListeners',
		value: function setListeners() {
			var _this3 = this;

			this.onEnded = new _promise2.default(function (resolve) {
				_this3.endedResolve = resolve;
			});
		}
	}, {
		key: 'remove',
		value: function remove() {
			var _this4 = this;

			this.removeListeners();
			this.buttons.forEach(function (btn) {
				btn.node.removeEventListener('click', _this4.onClickButton);
				btn.remove();
			});
			this.svg.parentNode.removeChild(this.svg);
			this.node.parentNode.removeChild(this.node);
		}
	}]);

	return InteractiveVideo;
}(_Step2.Step);

},{"./Step":14,"./utils/DrawSVG.min":15,"./utils/ieDetect":17,"gsap":"gsap","promise":3}],12:[function(require,module,exports){
'format es6';
'use strict';

Object.defineProperty(exports, "__esModule", {
	value: true
});
exports.LinearVideo = exports.VIDEO_ENDED = undefined;

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _promise = require('promise');

var _promise2 = _interopRequireDefault(_promise);

var _Step2 = require('./Step');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var VIDEO_ENDED = exports.VIDEO_ENDED = 'video_ended';

var LinearVideo = exports.LinearVideo = function (_Step) {
	_inherits(LinearVideo, _Step);

	function LinearVideo() {
		var _ref;

		var _temp, _this, _ret;

		_classCallCheck(this, LinearVideo);

		for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
			args[_key] = arguments[_key];
		}

		return _ret = (_temp = (_this = _possibleConstructorReturn(this, (_ref = LinearVideo.__proto__ || Object.getPrototypeOf(LinearVideo)).call.apply(_ref, [this].concat(args))), _this), _this.videoPromise = function () {
			_this.endedResolve();
		}, _temp), _possibleConstructorReturn(_this, _ret);
	}

	_createClass(LinearVideo, [{
		key: 'setListeners',
		value: function setListeners() {
			var _this2 = this;

			this.onEnded = new _promise2.default(function (resolve) {
				_this2.endedResolve = resolve;
				_this2.video.addEventListener('ended', _this2.videoPromise);
			});
		}
	}, {
		key: 'start',
		value: function start() {
			this.setListeners();
			this.video.currentTime = 0;
			this.video.setAttribute('preload', 'preload');
			this.video.setAttribute('autoplay', 'autoplay');
			this.video.play();
		}
	}, {
		key: 'remove',
		value: function remove() {
			this.removeListeners();
			this.video.removeEventListener('ended', this.videoPromise);

			if (this.node.parentNode) {
				this.node.parentNode.removeChild(this.node);
			}
		}
	}]);

	return LinearVideo;
}(_Step2.Step);

},{"./Step":14,"promise":3}],13:[function(require,module,exports){
'format es6';
'use strict';

require('babel-polyfill');

var _gsap = require('gsap');

var _promise = require('promise');

var _promise2 = _interopRequireDefault(_promise);

var _jquery = require('jquery');

var _jquery2 = _interopRequireDefault(_jquery);

var _Step = require('./Step');

var _LinearVideo = require('./LinearVideo');

var _InteractiveVideo = require('./InteractiveVideo');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

(0, _jquery2.default)(document).ready(function () {
	var app = document.querySelector('#app');
	var startApp = document.querySelector('#startApp');
	var volume = document.querySelector('#volume');
	var startUI = document.querySelector('.start-ui');

	var styles = document.createElement('style');
	app.appendChild(styles);
	styles.innerHTML = '';

	var steps = [];

	var currentStep = null;

	function getStepBySlug(slug) {
		return steps.find(function (step) {
			return step.slug === slug;
		});
	}

	function preloadNextSteps(step) {
		var nextSteps = [getStepBySlug(step.next), getStepBySlug(step.success), getStepBySlug(step.fail)];

		nextSteps.filter(function (s) {
			return s;
		}).forEach(function (s) {
			console.log('preloading', s.slug);
			var canplay = function canplay() {
				s.video.removeEventListener('canplay', canplay);
			};
			s.video.addEventListener('canplay', canplay);
			s.video.preload = 'auto';
			s.preattach(app, true);
		});
	}

	function manageVolume() {
		volume.classList.toggle('muted');
		var isMuted = volume.classList.contains('muted');
		steps.forEach(function (s) {
			s.video.muted = isMuted;
		});
	}

	function onResize() {
		var width = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth;

		var height = window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight;

		var computedWidth = width;
		var computedMargin = 0;

		if (height < width / 16 * 9) {
			computedWidth = height / 9 * 16;
			computedMargin = (width - computedWidth) / 2;
		}

		styles.innerHTML = '.ctn-step { \n\t\t\twidth: ' + computedWidth + 'px;\n\t\t\tmargin-left: ' + computedMargin + 'px;\n\t\t}';
	}

	function doStep(step) {
		step.attach(app);
		currentStep = step;

		step.onEnded.then(function () {
			var e = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : null;

			step.remove();
			var nextId = step.next;
			if (e) {
				nextId = step[e];
			}
			var next = getStepBySlug(nextId);
			if (!next) {
				//alert('end');
				window.location.href = 'http://canada.arcelormittal.com/';
			} else {
				doStep(next);
			}
		}).catch(function (e) {
			console.log(e);
			console.trace();
		});

		preloadNextSteps(step);
	}

	function onStart() {
		doStep(steps[0]);
		_gsap.TweenMax.set(startUI, { display: 'none' });
		_gsap.TweenMax.set(volume, { display: '' });
	}

	_gsap.TweenMax.set(startUI, { display: 'none' });
	_gsap.TweenMax.set(volume, { display: 'none' });

	_jquery2.default.ajax({
		url: './js/manifest.json',
		success: function success(data) {
			data.forEach(function (step) {
				switch (step.type) {
					default:
					case _Step.VIDEO:
						steps.push(new _LinearVideo.LinearVideo(step));
						break;
					case _Step.INTERACTIVE:
						steps.push(new _InteractiveVideo.InteractiveVideo(step));
						break;
				}
			});
			_gsap.TweenMax.set(startUI, { display: '' });
		}
	});

	document.addEventListener('keypress', function (e) {
		if (currentStep && (e.keyCode === 32 || e.which === 32)) {
			currentStep.video.currentTime = currentStep.video.duration - 2.5 || currentStep.video.currentTime;
		}
	});

	window.addEventListener('resize', onResize);
	onResize();
	startApp.addEventListener('click', onStart);
	volume.addEventListener('click', manageVolume);
});

},{"./InteractiveVideo":11,"./LinearVideo":12,"./Step":14,"babel-polyfill":"babel-polyfill","gsap":"gsap","jquery":"jquery","promise":3}],14:[function(require,module,exports){
'format es6';
'use strict';

Object.defineProperty(exports, "__esModule", {
	value: true
});
exports.Step = exports.INTERACTIVE = exports.VIDEO = exports.ENDED = undefined;

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _EventDispatcher2 = require('./utils/EventDispatcher');

var _EventDispatcher3 = _interopRequireDefault(_EventDispatcher2);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var ENDED = exports.ENDED = 'step_ended';

var VIDEO = exports.VIDEO = 'video';
var INTERACTIVE = exports.INTERACTIVE = 'interactive';

var Step = exports.Step = function (_EventDispatcher) {
	_inherits(Step, _EventDispatcher);

	_createClass(Step, [{
		key: 'infosToProps',
		value: function infosToProps(infos) {
			var _this2 = this;

			Object.keys(infos).forEach(function (k) {
				_this2[k] = infos[k];
			});
		}
	}]);

	function Step(infos) {
		_classCallCheck(this, Step);

		var _this = _possibleConstructorReturn(this, (Step.__proto__ || Object.getPrototypeOf(Step)).call(this));

		_this.onClickPlayPause = function () {
			_this.playPause.classList.toggle('playing');

			if (_this.playPause.classList.contains('playing')) {
				_this.video.play();
			} else {
				_this.video.pause();
			}
		};

		_this.preattach = function (el) {
			var hidden = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;

			console.log('pre-attaching', _this.slug);
			el.appendChild(_this.node);
			_this.node.classList[hidden ? 'add' : 'remove']('inactive');
		};

		_this.infosToProps(infos);

		_this.node = document.createElement('div');
		_this.node.classList.add('ctn-step');

		_this.video = document.createElement('video');

		var prefix = ~window.location.href.indexOf('workspace') ? 'videos/' : 'https://s3.amazonaws.com/arcelor-security-videos/';

		_this.video.src = prefix + _this.video_src;
		// this.video.playbackRate = 3.0;
		_this.video.setAttribute('webkit-playsinline', 'webkit-playsinline');
		_this.video.setAttribute('playsinline', 'playsinline');
		_this.video.preload = 'none';
		_this.node.appendChild(_this.video);

		_this.playPause = document.createElement('div');
		_this.playPause.classList.add('play-pause', 'playing');
		_this.node.appendChild(_this.playPause);

		_this.playPause.removeEventListener('click', _this.onClickPlayPause);
		_this.playPause.addEventListener('click', _this.onClickPlayPause);

		_this.init();
		return _this;
	}

	_createClass(Step, [{
		key: 'init',
		value: function init() {}
	}, {
		key: 'setListeners',
		value: function setListeners() {}
	}, {
		key: 'start',
		value: function start() {}
	}, {
		key: 'remove',
		value: function remove() {}
	}, {
		key: 'attach',
		value: function attach(el) {
			this.preattach(el);
			this.start();
		}
	}]);

	return Step;
}(_EventDispatcher3.default);

},{"./utils/EventDispatcher":16}],15:[function(require,module,exports){
(function (global){
"use strict";

/*!
 * VERSION: 0.0.5
 * DATE: 2015-05-19
 * UPDATES AND DOCS AT: http://greensock.com
 *
 * @license Copyright (c) 2008-2015, GreenSock. All rights reserved.
 * DrawSVGPlugin is a Club GreenSock membership benefit; You must have a valid membership to use
 * this code without violating the terms of use. Visit http://greensock.com/club/ to sign up or get more details.
 * This work is subject to the software agreement that was issued with your membership.
 * 
 * @author: Jack Doyle, jack@greensock.com
 */
var _gsScope = "undefined" != typeof module && module.exports && "undefined" != typeof global ? global : undefined || window;(_gsScope._gsQueue || (_gsScope._gsQueue = [])).push(function () {
  "use strict";
  function t(t, e, i, r) {
    return i = parseFloat(i) - parseFloat(t), r = parseFloat(r) - parseFloat(e), Math.sqrt(i * i + r * r);
  }function e(t) {
    return "string" != typeof t && t.nodeType || (t = _gsScope.TweenLite.selector(t), t.length && (t = t[0])), t;
  }function i(t, e, i) {
    var r,
        s,
        n = t.indexOf(" ");return -1 === n ? (r = void 0 !== i ? i + "" : t, s = t) : (r = t.substr(0, n), s = t.substr(n + 1)), r = -1 !== r.indexOf("%") ? parseFloat(r) / 100 * e : parseFloat(r), s = -1 !== s.indexOf("%") ? parseFloat(s) / 100 * e : parseFloat(s), r > s ? [s, r] : [r, s];
  }function r(i) {
    if (!i) return 0;i = e(i);var r,
        s,
        n,
        a,
        o,
        l,
        h,
        u,
        f = i.tagName.toLowerCase();if ("path" === f) o = i.style.strokeDasharray, i.style.strokeDasharray = "none", r = i.getTotalLength() || 0, i.style.strokeDasharray = o;else if ("rect" === f) s = i.getBBox(), r = 2 * (s.width + s.height);else if ("circle" === f) r = 2 * Math.PI * parseFloat(i.getAttribute("r"));else if ("line" === f) r = t(i.getAttribute("x1"), i.getAttribute("y1"), i.getAttribute("x2"), i.getAttribute("y2"));else if ("polyline" === f || "polygon" === f) for (n = i.getAttribute("points").split(" "), r = 0, o = n[0].split(","), "polygon" === f && (n.push(n[0]), -1 === n[0].indexOf(",") && n.push(n[1])), l = 1; n.length > l; l++) {
      a = n[l].split(","), 1 === a.length && (a[1] = n[l++]), 2 === a.length && (r += t(o[0], o[1], a[0], a[1]) || 0, o = a);
    } else "ellipse" === f && (h = parseFloat(i.getAttribute("rx")), u = parseFloat(i.getAttribute("ry")), r = Math.PI * (3 * (h + u) - Math.sqrt((3 * h + u) * (h + 3 * u))));return r || 0;
  }function s(t, i) {
    if (!t) return [0, 0];t = e(t), i = i || r(t) + 1;var s = a(t),
        n = s.strokeDasharray || "",
        o = parseFloat(s.strokeDashoffset),
        l = n.indexOf(",");return 0 > l && (l = n.indexOf(" ")), n = 0 > l ? i : parseFloat(n.substr(0, l)) || 1e-5, n > i && (n = i), [Math.max(0, -o), n - o];
  }var n,
      a = document.defaultView ? document.defaultView.getComputedStyle : function () {};n = _gsScope._gsDefine.plugin({ propName: "drawSVG", API: 2, version: "0.0.5", global: !0, overwriteProps: ["drawSVG"], init: function init(t, e) {
      if (!t.getBBox) return !1;var n,
          a,
          o,
          l = r(t) + 1;return this._style = t.style, e === !0 || "true" === e ? e = "0 100%" : e ? -1 === (e + "").indexOf(" ") && (e = "0 " + e) : e = "0 0", n = s(t, l), a = i(e, l, n[0]), this._length = l + 10, 0 === n[0] && 0 === a[0] ? (o = Math.max(1e-5, a[1] - l), this._dash = l + o, this._offset = l - n[1] + o, this._addTween(this, "_offset", this._offset, l - a[1] + o, "drawSVG")) : (this._dash = n[1] - n[0] || 1e-6, this._offset = -n[0], this._addTween(this, "_dash", this._dash, a[1] - a[0] || 1e-5, "drawSVG"), this._addTween(this, "_offset", this._offset, -a[0], "drawSVG")), !0;
    }, set: function set(t) {
      this._firstPT && (this._super.setRatio.call(this, t), this._style.strokeDashoffset = this._offset, this._style.strokeDasharray = (1 === t || 0 === t) && .001 > this._offset && 10 >= this._length - this._dash ? "none" : this._dash + "px," + this._length + "px");
    } }), n.getLength = r, n.getPosition = s;
}), _gsScope._gsDefine && _gsScope._gsQueue.pop()();

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],16:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
	value: true
});
exports.default = EventDispatcher;
/**
 * @author mrdoob / http://mrdoob.com/
 */

function EventDispatcher() {}

Object.assign(EventDispatcher.prototype, {
	addEventListener: function addEventListener(type, listener) {
		if (this._listeners === undefined) this._listeners = {};

		var listeners = this._listeners;

		if (listeners[type] === undefined) {
			listeners[type] = [];
		}

		if (listeners[type].indexOf(listener) === -1) {
			listeners[type].push(listener);
		}
	},
	hasEventListener: function hasEventListener(type, listener) {
		if (this._listeners === undefined) return false;
		var listeners = this._listeners;
		return listeners[type] !== undefined && listeners[type].indexOf(listener) !== -1;
	},
	removeListeners: function removeListeners() {
		this._listeners = undefined;
	},
	removeEventListener: function removeEventListener(type, listener) {
		if (this._listeners === undefined) return;
		var listeners = this._listeners;
		var listenerArray = listeners[type];

		if (listenerArray !== undefined) {
			var index = listenerArray.indexOf(listener);

			if (index !== -1) {
				listenerArray.splice(index, 1);
			}
		}
	},
	dispatchEvent: function dispatchEvent(event) {
		if (this._listeners === undefined) return;
		var listeners = this._listeners;
		var listenerArray = listeners[event.type];

		if (listenerArray !== undefined) {
			event.target = this;
			var array = listenerArray.slice(0);
			for (var i = 0, l = array.length; i < l; i++) {
				array[i].call(this, event);
			}
		}
	}
});

},{}],17:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
	value: true
});
function detectIE() {
	var ua = window.navigator.userAgent;

	// Test values; Uncomment to check result …

	// IE 10
	// ua = 'Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.2; Trident/6.0)';

	// IE 11
	// ua = 'Mozilla/5.0 (Windows NT 6.3; Trident/7.0; rv:11.0) like Gecko';

	// Edge 12 (Spartan)
	// ua = 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/39.0.2171.71 Safari/537.36 Edge/12.0';

	// Edge 13
	// ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/46.0.2486.0 Safari/537.36 Edge/13.10586';

	var msie = ua.indexOf('MSIE ');
	if (msie > 0) {
		// IE 10 or older => return version number
		return parseInt(ua.substring(msie + 5, ua.indexOf('.', msie)), 10);
	}

	var trident = ua.indexOf('Trident/');
	if (trident > 0) {
		// IE 11 => return version number
		var rv = ua.indexOf('rv:');
		return parseInt(ua.substring(rv + 3, ua.indexOf('.', rv)), 10);
	}

	var edge = ua.indexOf('Edge/');
	if (edge > 0) {
		// Edge (IE 12+) => return version number
		return parseInt(ua.substring(edge + 5, ua.indexOf('.', edge)), 10);
	}

	// other browser
	return false;
}

var isIE = exports.isIE = detectIE();

},{}]},{},[13])

//# sourceMappingURL=app.js.map

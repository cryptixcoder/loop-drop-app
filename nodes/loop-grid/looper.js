var Observ = require('mutant/value')
var computed = require('mutant/computed')
var Recorder = require('lib/loop-recorder')
var MutantArray = require('mutant/array')
var ArrayGrid = require('array-grid')

module.exports = Looper

function Looper (loopGrid) {
  var base = Observ([])
  var transforms = MutantArray([])
  var releases = []
  var undos = []
  var redos = []

  var swing = loopGrid.context.swing || Observ(0)

  releases.push(
    loopGrid.loopLength(length => {
      var current = base()
      if (current) {
        current.loopLength = length
      }
    })
  )

  var transformedOutput = computed([base, transforms], function (base, transforms) {
    if (transforms.length) {
      var input = ArrayGrid(base.map(cloneLoop), loopGrid.shape())
      var result = transforms.slice().sort(prioritySort).reduce(performTransform, input)
      return (result && result.data) || []
    } else {
      return base
    }
  }, { nextTick: true })

  var obs = computed([transformedOutput, swing], function (input, swing) {
    return swingLoops(input, 0.5 + (swing * (1 / 6)))
  })

  obs.transforms = transforms

  var record = Recorder()
  var context = loopGrid.context
  var lastTruncateAt = 0

  // record all output events
  loopGrid.onEvent(function (data) {
    if (swing()) {
      var swingRatio = 0.5 + (swing() * (1 / 6))
      record(data.id, unswingPosition(data.position, swingRatio, 2), data.event === 'start')
    } else {
      record(data.id, data.position, data.event === 'start')
    }

    if (data.position - lastTruncateAt > 16) {
      lastTruncateAt = data.position
      record.truncate(data.position - 64)
    }
  })

  obs.store = function (pos, length) {
    length = length || loopGrid.loopLength() || 8
    pos = pos || context.scheduler.getCurrentPosition()
    var from = pos - length
    var result = loopGrid.targets().map(function (target, i) {
      var events = record.getRange(target, from, pos).map(function (data) {
        return [data[0] % length].concat(data.slice(1))
      }).sort(byPosition)

      if (events.length && !(events.length === 1 && !events[0][1])) {
        return { length: length, events: events }
      }
    })

    undos.push(base())

    result.loopLength = loopGrid.loopLength()
    base.set(result)
  }

  obs.flatten = function () {
    undos.push(base())
    var result = transformedOutput()
    result.loopLength = loopGrid.loopLength()
    base.set(result)
    transforms.set([])
  }

  obs.undo = function () {
    if (undos.length) {
      redos.push(base())
      base.set(undos.pop())

      if (base().loopLength) {
        loopGrid.loopLength.set(base().loopLength)
      }
    }
  }

  obs.redo = function () {
    if (redos.length) {
      undos.push(base())
      base.set(redos.pop() || [])

      if (base().loopLength) {
        loopGrid.loopLength.set(base().loopLength)
      }
    }
  }

  obs.transform = function (func, args) {
    var t = {
      func: func,
      args: Array.prototype.slice.call(arguments, 1),
      priority: 0
    }

    obs.transforms.push(t)

    return function release () {
      obs.transforms.delete(t)
    }
  }

  obs.transformTop = function (func, args) {
    var t = {
      func: func,
      args: Array.prototype.slice.call(arguments, 1),
      priority: 1
    }

    obs.transforms.push(t)

    return function release () {
      obs.transforms.delete(t)
    }
  }

  obs.isTransforming = function () {
    return !!obs.transforms.getLength()
  }

  obs.destroy = function () {
    while (releases.length) {
      releases.pop()()
    }
  }

  return obs

  // scoped

  function swingLoops (loops, ratio) {
    if (ratio !== 0.5) {
      return loops.map(function (loop) {
        if (loop) {
          loop = ensureLength(loop, 1 / 2)

          return {
            events: loop.events.map(function (event) {
              var at = swingPosition(event[0], ratio, 2)
              return [at].concat(event.slice(1))
            }),
            length: loop.length
          }
        }
      })
    } else {
      return loops
    }
  }
}

function ensureLength (loop, minLength) {
  if (!loop.length || loop.length >= minLength) {
    return loop
  } else {
    var result = {
      events: loop.events.concat(),
      length: loop.length
    }

    while (result.length < minLength) {
      for (var i = 0; i < loop.events.length; i++) {
        var orig = loop.events[i]
        result.events.push([orig[0] + result.length].concat(orig.slice(1)))
      }
      result.length += loop.length
    }

    return result
  }
}

function cloneLoop (loop) {
  if (loop && Array.isArray(loop.events)) {
    return {
      events: loop.events.concat(),
      length: loop.length
    }
  }
}

function performTransform (input, f) {
  return f.func.apply(this, [input].concat(f.args || []))
}

function unswingPosition (position, center, grid) {
  grid = grid || 1
  position = position * grid
  var rootPos = Math.floor(position)
  var pos = (position % 1)
  var posOffset = pos < center
    ? pos / center * 0.5
    : 0.5 + ((pos - center) / (1 - center) * 0.5)
  return (rootPos + posOffset) / grid
}

function swingPosition (position, center, grid) {
  grid = grid || 1
  position = position * grid
  var rootPos = Math.floor(position)
  var pos = (position % 1) * 2 - 1
  var posOffset = pos < 0
    ? (1 + pos) * center
    : center + pos * (1 - center)
  return (rootPos + posOffset) / grid
}

function prioritySort (a, b) {
  return ((a && a.priority) || 0) - ((b && b.priority) || 0)
}

function byPosition (a, b) {
  return a[0] - b[0]
}

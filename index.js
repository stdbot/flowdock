const { EventEmitter } = require('events')
const flowdock = require('flowdock')
const format = require('./format')

const flowPath = flow =>
  `${flow.organization.parameterized_name}/${flow.parameterized_name}`

const findFlow = identifier => flow =>
  flow.id === identifier ||
    flow.parameterized_name === identifier ||
    flowPath(flow) === identifier ||
    flow.name.toLowerCase() === identifier.toLowerCase()

const isFlowSelected = flows => flow =>
  flows.find(identifier => findFlow(identifier)(flow))

const callRes = (session, method, ...args) =>
  new Promise((resolve, reject) =>
    session[method](...args, (err, body, res) =>
      err ? reject(err) : resolve(res)))

const call = (...args) =>
  callRes(...args).then(res => res.body)

const getRawState = session =>
  callRes(session, 'flows')
    .then(res => ({
      userId: res.headers['flowdock-user'],
      flows: res.body
    }))

function Flowdock (config) {
  const emitter = new EventEmitter()
  const session = new flowdock.Session(config.token)
  const onError = err => emitter.emit('error', err)
  const state = {}

  const onEvent = event =>
    event.user !== state.userId && emitter.emit(`raw:${event.event}`, event)

  const onLoad = newState => {
    const flows = newState.flows
      .filter(config.flows ? isFlowSelected(config.flows) : flow => flow.joined)
      .map(flow => flow.id)

    if (state.stream) {
      state.stream.removeAllListeners()
    }

    state.stream = session.stream(flows, config.streamConfig)
      .on('message', onEvent)
      .on('error', onError)
  }

  const onMessage = message =>
    emitter.emit('message', format.message(state)(message))

  const onJoinUser = message =>
    state.usersById[message.user] = format.user(message.content.user)

  const reload = () => {
    getRawState(session)
      .then(format.state)
      .then(state => emitter.emit('load', state))
      .catch(onError)
  }

  emitter.on('load', newState => Object.assign(state, newState))
  emitter.on('load', onLoad)
  emitter.on('raw:message', onMessage)
  emitter.on('raw:backend.join.user', onJoinUser)
  emitter.on('raw:flow-add', reload)
  emitter.on('raw:source-remove', reload)

  emitter.mention = user => `@${user.name}`
  emitter.address = (user, text) => `${emitter.mention(user)}, ${text}`

  emitter.isMentioned = (user, message) =>
    message.raw.tags.includes(`:user:${user.id}`)

  const sendFlow = (message, text) =>
    call(session, 'threadMessage', message.raw.flow, message.raw.thread_id, text, [])

  const sendPrivate = (message, text) =>
    call(session, 'privateMessage', message.author.id, text, [])

  emitter.send = (message, text) =>
    (message.raw.to ? sendPrivate : sendFlow)(message, text)
      .then(format.message(state))

  const editFlow = (message, text) => {
    const flowObject = state.flowsById[message.raw.flow]
    const flow = flowObject.parameterized_name
    const org = flowObject.organization.parameterized_name

    return call(session, 'editMessage', flow, org, message.id, { content: text })
  }

  const editPrivate = (message, text) =>
    call(session, 'put', `/private/${message.raw.to}/messages/${message.id}`, { content: text })

  emitter.edit = (message, text) =>
    (message.raw.to ? editPrivate : editFlow)(message, text)
      .then(() => Object.assign({}, message, { text }))

  emitter.messageRoom = (room, text) => {
    const flow = state.flows.find(findFlow(room))

    return call(session, 'message', flow ? flow.id : room, text, [])
      .then(format.message(state))
  }

  emitter.end = () => state.stream && state.stream.end()

  reload()

  return emitter
}

module.exports = Flowdock

exports.user = user => ({
  raw: user,
  id: user.id,
  name: user.nick,
  fullName: user.name,
  email: user.email,
  image: user.avatar,
  url: user.website
})

exports.message = state => message => ({
  raw: message,
  id: message.id,
  author: state.usersById[message.user],
  text: message.content
})

const indexBy = (prop, items) =>
  items.reduce((index, item) => (index[item[prop]] = item, index), {})

const flatten = items => [].concat(...items)

exports.state = state => {
  const { userId, flows } = state
  const flowsById = indexBy('id', flows)
  const users = flatten(flows.map(flow => flow.users)).map(exports.user)
  const usersById = indexBy('id', users)

  return { userId, flows, flowsById, usersById }
}

// 桌宠对外的三个动作，供侧栏面板、输入框按钮调用。
//
// Vue 应用挂在自己的根节点里，React 面板碰不到它的组件实例，所以留一组
// 函数指针：PetContainer 挂载时填上，卸载时清空。

export const petActions = {
  openSettings: null,
  closeSettings: null,
  tease: null,
  reloadModel: null,
  isReady: () => false,
  describe: () => '',
  commentModel: () => null,
  setCommentModel: null,
}

export function providePetActions(actions) {
  Object.assign(petActions, actions)
}

export function clearPetActions() {
  petActions.openSettings = null
  petActions.closeSettings = null
  petActions.tease = null
  petActions.reloadModel = null
  petActions.isReady = () => false
  petActions.describe = () => ''
  petActions.commentModel = () => null
  petActions.setCommentModel = null
}

export function openPetSettings() {
  try {
    petActions.openSettings?.()
    return true
  } catch {
    return false
  }
}

export function teasePet() {
  try {
    return petActions.tease?.() === true
  } catch {
    return false
  }
}

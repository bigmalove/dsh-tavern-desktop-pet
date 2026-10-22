// 桌宠对外的三个动作，供侧栏面板、输入框按钮调用。
//
// Vue 应用挂在自己的根节点里，React 面板碰不到它的组件实例，所以留一组
// 函数指针：PetContainer 挂载时填上，卸载时清空。

export const petActions = {
  openSettings: null,
  closeSettings: null,
  show: null,
  hide: null,
  isVisible: () => false,
  tease: null,
  reloadModel: null,
  isReady: () => false,
  describe: () => '',
  commentModel: () => null,
  setCommentModel: null,
  // 卡片工作台引导：设置读写与当前识别状态（侧栏面板用）。
  guideSettings: () => ({ enabled: true, fold: true }),
  setGuideSettings: null,
  guideStatus: () => '',
  // 工作状态（Tavern 第 7 版）：当前状态与一行文案，侧栏面板显示用。
  workStatus: () => null,
  workStatusLabel: () => '',
}

export function providePetActions(actions) {
  Object.assign(petActions, actions)
}

export function clearPetActions() {
  petActions.openSettings = null
  petActions.closeSettings = null
  petActions.show = null
  petActions.hide = null
  petActions.isVisible = () => false
  petActions.tease = null
  petActions.reloadModel = null
  petActions.isReady = () => false
  petActions.describe = () => ''
  petActions.commentModel = () => null
  petActions.setCommentModel = null
  petActions.guideSettings = () => ({ enabled: true, fold: true })
  petActions.setGuideSettings = null
  petActions.guideStatus = () => ''
  petActions.workStatus = () => null
  petActions.workStatusLabel = () => ''
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

/// <reference types="vite/client" />

// .vue 单文件组件的模块类型声明（IDE TS 语言服务解析 import *.vue 所需；
// vue-tsc 有原生 .vue 支持，不受此声明影响）
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

// 构建身份（vite.config.ts define 注入）：git 短哈希，检查更新用——本机运行包与云端 version.json 比对
declare const __BUILD_ID__: string

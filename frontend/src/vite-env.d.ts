/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 后端地址;不设 = 跟着地址栏的主机名走 8000,空串 = 同源(见 .env.example) */
  readonly VITE_API_BASE_URL?: string;
  /** 后端端口(不设 = 8000);源码文件夹的启动器把后端开在别的端口时传进来,主机名照样跟地址栏走 */
  readonly VITE_API_PORT?: string;
  /** 测试环境的角标文字(比如「测试版 · 库副本」);正式环境不设 */
  readonly VITE_ENV_LABEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

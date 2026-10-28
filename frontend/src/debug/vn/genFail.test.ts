import { describe, expect, it } from 'vitest';
import { errorMain, errorTitle, firstLine, holdsUserLine, userSaid } from './genFail';

describe('errorTitle', () => {
  // 后端现在给的是英文原话
  it.each([
    ['Cannot connect to https://api.deepseek.com', '连不上模型'],
    ['Cannot connect to https://api.deepseek.com: [Errno 11001] getaddrinfo failed', '连不上模型'],
    ['Cannot connect to http://127.0.0.1:5000/v1: connection timed out', '连不上模型'],
    ['Failed to fetch', '连不上模型'],
    ['401 Unauthorized: Incorrect API key provided', '密钥不对'],
    ['402 Payment Required: Insufficient Balance', '余额不足'],
    ['429 Too Many Requests: You exceeded your current quota, please check your plan and billing details', '余额不足'],
    ['429 Too Many Requests: Rate limit exceeded', '请求太频繁'],
    ['429 Too Many Requests', '请求太频繁'],
    ['403 Forbidden: Your key does not have access to this model', '没有权限'],
    ['Cannot connect to https://relay.invalid/v1: 403 Forbidden', '连不上模型'],
    ['404 Not Found: The model `gpt-9` does not exist', '找不到这个模型'],
    ['400 Bad Request: The model xyz does not exist', '找不到这个模型'],
    ['Request to https://llm.test/v1 timed out', '模型没有响应'],
    ['500 Internal Server Error: upstream failure', '模型那边出错了'],
    ['502 Bad Gateway', '模型那边出错了'],
    ['Empty response: no choices', '模型那边出错了'],
    ['Empty response: the stream ended with no content', '模型那边出错了'],
    ['Stream interrupted: peer closed connection', '模型那边出错了'],
    ['Stream ended unexpectedly: no done frame received', '模型那边出错了'],
    ["Connection 'DeepSeek' has no API key", '连接还没设好'],
    ["Connection 'DeepSeek' has no model name set", '连接还没设好'],
    ['No active connection', '连接还没设好'],
    ['Connection not found', '连接还没设好'],
    ['Got a web page instead of an API response from https://llm.test (HTTP 301)', '没拿到回复'],
    ['Unknown API type: future', '没拿到回复'],
    ['Request failed: weird', '没拿到回复'],
    ['messages must not be empty', '没拿到回复'],
    ['anima检测到有瑟瑟倾向，有相关需求请移步本地部署', '这条回复被撤回了'],
    ['something odd', '没拿到回复'],
  ])('%s → %s', (msg, title) => {
    expect(errorTitle(msg)).toBe(title);
  });

  // 旧后端 / 旧存档里还可能有中文原文,标题照旧
  it.each([
    ['无法连接到 https://api.deepseek.com——检查地址拼写和网络', '连不上模型'],
    ['API 密钥无效或已过期 (401)', '密钥不对'],
    ['请求被限流 (429)，稍后重试或检查余额', '请求太频繁'],
    ['模型不存在 (404)——检查模型名拼写', '找不到这个模型'],
    ['没有启用的 API 连接，请先在设置里添加并启用一个', '连接还没设好'],
  ])('旧中文:%s → %s', (msg, title) => {
    expect(errorTitle(msg)).toBe(title);
  });
});

describe('errorMain', () => {
  it('密钥 / 余额这类先换模型,其余先重试', () => {
    expect(errorMain('401 Unauthorized: Incorrect API key provided')).toBe('model');
    expect(errorMain('402 Payment Required: Insufficient Balance')).toBe('model');
    expect(errorMain('404 Not Found: The model `x` does not exist')).toBe('model');
    expect(errorMain('Failed to fetch')).toBe('retry');
    expect(errorMain('429 Too Many Requests: Rate limit exceeded')).toBe('retry');
  });
});

describe('firstLine / userSaid', () => {
  it('原文只留第一行', () => {
    expect(firstLine('\n  a\nb')).toBe('a');
  });
  it('你说的那句:去掉「——」提示行和外层引号', () => {
    expect(userSaid('——场景切换为逛街\n「好啊」')).toBe('好啊');
    expect(userSaid('——只有提示')).toBe('——只有提示');
  });
});

describe('holdsUserLine', () => {
  it('失败了而且最后一条是你说的才停住;有回复(哪怕只写了一半)或没失败都照常', () => {
    expect(holdsUserLine(true, 'user')).toBe(true);
    expect(holdsUserLine(true, 'assistant')).toBe(false);
    expect(holdsUserLine(false, 'user')).toBe(false);
    expect(holdsUserLine(true, undefined)).toBe(false);
  });
});

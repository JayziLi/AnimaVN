// 原型用的演示数据:从 userdata/tables 里抄出来的几张卡(立绘、脸的位置、场景包背景)。生成方式见 README
const BLOBS = "../../../userdata/blobs/";
const CAST = [
 {
  "name": "星绘",
  "work": "卡拉彼丘",
  "tags": [
   "日语配音",
   "本地测试",
   "视觉小说",
   "甜蜜女友"
  ],
  "sprites": [
   {
    "label": "微笑",
    "src": "b9/b9b0617f3ef50b782fe3ee07535beaed23e7f999a1039e37177462187d7e2f75.png",
    "w": 802,
    "h": 1440,
    "face": {
     "x": 0.3526,
     "y": 0.0957,
     "w": 0.3719,
     "h": 0.207
    }
   },
   {
    "label": "平静",
    "src": "ff/ff181fb3ca973770160c1ca32a21498eb326a6bd9664d3b841fdcad2983de9eb.png",
    "w": 802,
    "h": 1440,
    "face": {
     "x": 0.3614,
     "y": 0.1045,
     "w": 0.3509,
     "h": 0.1953
    }
   },
   {
    "label": "开心",
    "src": "e6/e61bf8320c4e9b8257f6266e8faa585bd790d98ed137d6965863ebe97bcb26e2.png",
    "w": 802,
    "h": 1440,
    "face": {
     "x": 0.3526,
     "y": 0.0977,
     "w": 0.3667,
     "h": 0.2041
    }
   },
   {
    "label": "温柔",
    "src": "d1/d15d13255ce71c06980ff7d2572e1eb07b8a3c846810eec316c5fb8b8b325d3b.png",
    "w": 802,
    "h": 1440,
    "face": {
     "x": 0.3614,
     "y": 0.1035,
     "w": 0.3544,
     "h": 0.1973
    }
   },
   {
    "label": "认真",
    "src": "ef/ef096782cab0b6ad81c1a27d8b581f6e70d63f94d53f39798231a6813d05ae75.png",
    "w": 802,
    "h": 1440,
    "face": {
     "x": 0.3526,
     "y": 0.0938,
     "w": 0.3807,
     "h": 0.2119
    }
   },
   {
    "label": "担心",
    "src": "d2/d2b95e22bf25205dd0626d6e1f883f1b3eaee44e2b2f3eae0e60bfc8819b57da.png",
    "w": 802,
    "h": 1440,
    "face": {
     "x": 0.3632,
     "y": 0.1006,
     "w": 0.3596,
     "h": 0.2002
    }
   }
  ],
  "scenes": [
   {
    "label": "卧室",
    "src": "90/90bf211892b408785ea0db633dc5adc72702040d7da0e8025924440c98fd9ed2.jpg",
    "focus": 50
   },
   {
    "label": "深夜卧室",
    "src": "8d/8d866b7314a0af4af0e119c0f1c58d3a6d28e367ea2d999dbc5ff20ecadda6bf.jpg",
    "focus": 50
   },
   {
    "label": "客厅",
    "src": "41/41f627b923587a332587d7ba5cea32a44ea50d14abd5ce0b19fbd65cfee87345.jpg",
    "focus": 50
   },
   {
    "label": "客厅夜",
    "src": "22/22bdb895c99ab62a4171a8ae504e8de6d073b56cceb8f47cd37b156c9e0c1afb.jpg",
    "focus": 50
   },
   {
    "label": "书桌",
    "src": "5b/5b67697dda296052c01d6dfe9ac71369b7be4cb4fa3f7c951821b0b950d7ac5c.jpg",
    "focus": 50
   },
   {
    "label": "星庇所",
    "src": "8b/8b894fbd3dac58e6ae279c1520356d6098e67abde3a54b6e7ca317c5adcfadff.jpg",
    "focus": 45
   }
  ]
 },
 {
  "name": "芳乃",
  "work": "千恋万花",
  "tags": [
   "日语配音",
   "本地测试",
   "视觉小说",
   "甜蜜女友"
  ],
  "sprites": [
   {
    "label": "微笑",
    "src": "35/35f72957b695796304a9c148831b285f0c0472e3b80c9bd2729ae27b19bb8a22.png",
    "w": 1058,
    "h": 1300,
    "face": {
     "x": 0.3806,
     "y": 0.1182,
     "w": 0.3325,
     "h": 0.2705
    }
   },
   {
    "label": "说话",
    "src": "58/58dd6690d29c9a536bce2cb031975006c382fe71345cbc2704bcd7670ebda48d.png",
    "w": 1058,
    "h": 1300,
    "face": {
     "x": 0.3758,
     "y": 0.1143,
     "w": 0.3397,
     "h": 0.2764
    }
   },
   {
    "label": "平静",
    "src": "0f/0febb9bf0fff47c8ec375b11a4dbf947a36d8a1241ad6f998e553a2bfdf3b336.png",
    "w": 1058,
    "h": 1300,
    "face": {
     "x": 0.377,
     "y": 0.1172,
     "w": 0.3337,
     "h": 0.2715
    }
   },
   {
    "label": "开心",
    "src": "3f/3fd7f58d4a08d0e6387cef32f68c47c6a9d223c738995bf252bdfe3c51198d9a.png",
    "w": 1058,
    "h": 1300,
    "face": {
     "x": 0.3986,
     "y": 0.1377,
     "w": 0.2881,
     "h": 0.2344
    }
   },
   {
    "label": "大笑",
    "src": "86/86de669aa0a3d0639854aa6769cf97a0e659cea92309e4b5586fea550e65c32b.png",
    "w": 1058,
    "h": 1300,
    "face": {
     "x": 0.3986,
     "y": 0.1367,
     "w": 0.2929,
     "h": 0.2383
    }
   },
   {
    "label": "温柔",
    "src": "32/32d2c1f24c98f06e1a79177e2d3a42921d81aa9eead96716f9b8c8f1bfc93f6e.png",
    "w": 1058,
    "h": 1300,
    "face": {
     "x": 0.3938,
     "y": 0.1377,
     "w": 0.2989,
     "h": 0.2432
    }
   }
  ],
  "scenes": [
   {
    "label": "深夜卧室",
    "src": "78/789d4763b6766135322f064032d3363fdc6c283dceca0716046b521bcb2f0efd.jpg",
    "focus": 45
   },
   {
    "label": "卧室",
    "src": "ac/aca177ca08986664c3eb61566f188cde579a91c16bbe879d4d4819459b9e420e.jpg",
    "focus": 45
   },
   {
    "label": "便利店",
    "src": "68/68ae1cf8b45852a4369107c8f9492f89ecfd261f20aa4bbbe762f4976760dbc6.jpg",
    "focus": 65
   },
   {
    "label": "便利店门口",
    "src": "c2/c29a2e0ef860842533f738b32ea9fef5f3d8c9ce0c0e4c5033e447547d4ffbc6.jpg",
    "focus": 45
   },
   {
    "label": "夜路",
    "src": "5e/5e9ceff77f36eba74898bdd09b424a7c22b0f6502e65d2f4bd20ebe11f8f86fb.jpg",
    "focus": 40
   },
   {
    "label": "樱花河堤",
    "src": "06/0680c94a337149ebf8ad0880246730dd7c6045ca65eee3fcb98cbb6cb08a12c9.jpg",
    "focus": 40
   }
  ]
 },
 {
  "name": "茉子",
  "work": "千恋万花",
  "tags": [
   "日语配音",
   "本地测试",
   "视觉小说",
   "甜蜜女友"
  ],
  "sprites": [
   {
    "label": "微笑",
    "src": "a0/a06c96a3045329209c1817034224c4251e854daeda006f6363a73ea41b998520.png",
    "w": 490,
    "h": 1300,
    "face": {
     "x": 0.0881,
     "y": 0.1279,
     "w": 0.7021,
     "h": 0.2646
    }
   },
   {
    "label": "说话",
    "src": "7a/7ac9dee54b2719a72a0a326d4c36a7a38d5990aa9902d0d015e2433728b8d9b9.png",
    "w": 490,
    "h": 1300,
    "face": {
     "x": 0.0984,
     "y": 0.1299,
     "w": 0.6917,
     "h": 0.2607
    }
   },
   {
    "label": "平静",
    "src": "14/143f2d17ef7011e8e81882fd3a7afb50d9a7d77818a58b846d7c4ad97011507f.png",
    "w": 490,
    "h": 1300,
    "face": {
     "x": 0.0881,
     "y": 0.127,
     "w": 0.7021,
     "h": 0.2646
    }
   },
   {
    "label": "开心",
    "src": "26/26616a99ebe34fc45daf8ab0b18c1d554cab1947312dd895a44dc8632e6a252b.png",
    "w": 490,
    "h": 1300,
    "face": {
     "x": 0.0881,
     "y": 0.1279,
     "w": 0.6995,
     "h": 0.2637
    }
   },
   {
    "label": "大笑",
    "src": "a6/a6d9d958d7a12da590b34967a8dab0ff0637f6bafe1388ae34aa19e72984b0c9.png",
    "w": 490,
    "h": 1300,
    "face": {
     "x": 0.0984,
     "y": 0.1299,
     "w": 0.6943,
     "h": 0.2617
    }
   },
   {
    "label": "温柔",
    "src": "08/08fa2295a1caef844d9c90e75ea8f8ab2f2f6b9fe07a378e6cba8bac3c445849.png",
    "w": 490,
    "h": 1300,
    "face": {
     "x": 0.0933,
     "y": 0.1299,
     "w": 0.6917,
     "h": 0.2607
    }
   }
  ],
  "scenes": [
   {
    "label": "深夜卧室",
    "src": "78/789d4763b6766135322f064032d3363fdc6c283dceca0716046b521bcb2f0efd.jpg",
    "focus": 45
   },
   {
    "label": "卧室",
    "src": "ac/aca177ca08986664c3eb61566f188cde579a91c16bbe879d4d4819459b9e420e.jpg",
    "focus": 45
   },
   {
    "label": "便利店",
    "src": "68/68ae1cf8b45852a4369107c8f9492f89ecfd261f20aa4bbbe762f4976760dbc6.jpg",
    "focus": 65
   },
   {
    "label": "便利店门口",
    "src": "c2/c29a2e0ef860842533f738b32ea9fef5f3d8c9ce0c0e4c5033e447547d4ffbc6.jpg",
    "focus": 45
   },
   {
    "label": "夜路",
    "src": "5e/5e9ceff77f36eba74898bdd09b424a7c22b0f6502e65d2f4bd20ebe11f8f86fb.jpg",
    "focus": 40
   },
   {
    "label": "樱花河堤",
    "src": "06/0680c94a337149ebf8ad0880246730dd7c6045ca65eee3fcb98cbb6cb08a12c9.jpg",
    "focus": 40
   }
  ]
 },
 {
  "name": "琴柳",
  "work": "明日方舟",
  "tags": [
   "本地测试",
   "视觉小说",
   "轻恋爱"
  ],
  "sprites": [
   {
    "label": "微笑",
    "src": "a6/a60be17029f6b7bde1471231281eab569e4dc5b7226f0dc894b96274f9d3c6bb.png",
    "w": 520,
    "h": 550,
    "face": null
   },
   {
    "label": "平静",
    "src": "40/40452dbd451a85b3a27cac3e34a2b430597fa26d7eceb4eec1922beebc21c252.png",
    "w": 520,
    "h": 550,
    "face": {
     "x": 0.3808,
     "y": 0.1327,
     "w": 0.1558,
     "h": 0.1473
    }
   },
   {
    "label": "温柔",
    "src": "87/876331eb95404b7ee53a502cddb3f728354316399ccc53946186153e449d0a3f.png",
    "w": 520,
    "h": 550,
    "face": null
   },
   {
    "label": "开心",
    "src": "07/0777f32a4b9e00a20b0426ff96d9b96dc76b3c9672bc14bf9d3696818525e41a.png",
    "w": 520,
    "h": 550,
    "face": null
   },
   {
    "label": "害羞",
    "src": "17/1741059071d25252871501aefe1cdcfc9d391b449238fb23edd744c4481581af.png",
    "w": 520,
    "h": 550,
    "face": null
   },
   {
    "label": "疑惑",
    "src": "fa/faf0ca090410a5e98bf1b91c9db4f827bda0f386c4d6d505bcffb38a36cd5290.png",
    "w": 520,
    "h": 550,
    "face": {
     "x": 0.3827,
     "y": 0.1291,
     "w": 0.1577,
     "h": 0.1491
    }
   }
  ],
  "scenes": [
   {
    "label": "办公室",
    "src": "f8/f8b59c77dc51fc8d9cc8cd3ce4f6cbacc74fcf946ab573d337c8177de76c918d.png",
    "focus": 45
   },
   {
    "label": "食堂",
    "src": "9c/9c965e76dcae809603884ee4cfe5f8874981fdc126d92ebd6a27e29fa07fc3c5.png",
    "focus": 50
   },
   {
    "label": "走廊",
    "src": "1d/1de589053d035ab7f7f5c6d8a295142cc2555da35e2bd70750a14e57dbdc9983.png",
    "focus": 50
   },
   {
    "label": "休息室",
    "src": "c9/c95f9eaafd23e226cf3d69a6bef3a6338107f264cb88c74b544a420b55e784d4.png",
    "focus": 40
   },
   {
    "label": "宿舍",
    "src": "ad/ad48c52c7d5f2815afac36e4e22181dd9d2fe0a26277fefe0cb1303f9e7e6d46.png",
    "focus": 65
   },
   {
    "label": "医疗部",
    "src": "e3/e3cf9a6cbebbd3e709ae46731f6e55945af04cdad38ea1f99fa4994f2889fe3f.png",
    "focus": 50
   }
  ]
 },
 {
  "name": "诺亚",
  "work": "蔚蓝档案",
  "tags": [
   "本地测试",
   "视觉小说",
   "轻恋爱"
  ],
  "sprites": [
   {
    "label": "微笑",
    "src": "ff/ff32406388a9a692b9203c5c167097acb87aae371718e9e49d97d450c6eabd8d.png",
    "w": 1015,
    "h": 1120,
    "face": {
     "x": 0.2511,
     "y": 0.1436,
     "w": 0.2511,
     "h": 0.2275
    }
   },
   {
    "label": "说话",
    "src": "36/36171cf108b710ef8bbfe53eacaba93f7700e61ab920982680b459c43da5fea4.png",
    "w": 1015,
    "h": 1120,
    "face": {
     "x": 0.2511,
     "y": 0.1436,
     "w": 0.2511,
     "h": 0.2275
    }
   },
   {
    "label": "平静",
    "src": "5a/5aef7bd84cf5dd8837a67e40956a16c1c614f5d9264515f1e668e73dd0b5dd74.png",
    "w": 1015,
    "h": 1120,
    "face": {
     "x": 0.2522,
     "y": 0.1465,
     "w": 0.2478,
     "h": 0.2246
    }
   },
   {
    "label": "观察",
    "src": "5a/5aef7bd84cf5dd8837a67e40956a16c1c614f5d9264515f1e668e73dd0b5dd74.png",
    "w": 1015,
    "h": 1120,
    "face": {
     "x": 0.2522,
     "y": 0.1465,
     "w": 0.2478,
     "h": 0.2246
    }
   },
   {
    "label": "开心",
    "src": "ff/ff39c8f46237dac14ae7ca819b9b6c1eca489a76b27a9a40656c63cc7acc7126.png",
    "w": 1015,
    "h": 1120,
    "face": {
     "x": 0.2532,
     "y": 0.1543,
     "w": 0.2414,
     "h": 0.2188
    }
   },
   {
    "label": "温柔",
    "src": "32/324ec1ce2a8d4dc13a7a632698ca1377aa965e1ed44f16df62ba0b95d3d33c99.png",
    "w": 1015,
    "h": 1120,
    "face": {
     "x": 0.2597,
     "y": 0.1582,
     "w": 0.2328,
     "h": 0.2109
    }
   }
  ],
  "scenes": [
   {
    "label": "夏莱办公室",
    "src": "b6/b6f99792598d19335ab24253cd9066619999236b8d40955a111adef59270dc1c.jpg",
    "focus": 45
   },
   {
    "label": "夏莱黄昏",
    "src": "ff/ffdcaeaea121c65494589c0c764b531cba8e5ee5a2f4fbc8d0e2fd0bd3a5cc9d.jpg",
    "focus": 45
   },
   {
    "label": "夏莱深夜",
    "src": "e2/e20cd2207685aca28bf9405e371cdd93fa9c150c3e1aa66369cd4f97a7d08178.jpg",
    "focus": 45
   },
   {
    "label": "夏莱休息室",
    "src": "99/99b87ccf285c4242bfe96b9e77ea5dad9a7a514bf31d021eac697f95113ee241.jpg",
    "focus": 65
   },
   {
    "label": "研讨会办公室",
    "src": "eb/eb4b0c326cca51786cae2584304bab8b428589e10ee5a1e338266f78a87c9a37.jpg",
    "focus": 35
   },
   {
    "label": "千年校园",
    "src": "da/dad79890b674a83e9b9b7f1beaaf716915aa6b0006796d514033af69ce11007c.jpg",
    "focus": 60
   }
  ]
 },
 {
  "name": "阿米娅",
  "work": "明日方舟",
  "tags": [
   "本地测试",
   "视觉小说"
  ],
  "sprites": [
   {
    "label": "平静",
    "src": "14/14c5159f39776e965e1d6cc2d9fed8215acdb227f6602dc8a108098be259dd1d.png",
    "w": 472,
    "h": 600,
    "face": {
     "x": 0.3411,
     "y": 0.2883,
     "w": 0.2225,
     "h": 0.175
    }
   },
   {
    "label": "微笑",
    "src": "5d/5da51ccdcb055e3fdaf8334e07a05dd06823d64787b475ca34d4dd57967a7476.png",
    "w": 472,
    "h": 600,
    "face": {
     "x": 0.3411,
     "y": 0.2867,
     "w": 0.2225,
     "h": 0.175
    }
   },
   {
    "label": "开心",
    "src": "32/323bf3f32a45d4566e26c945f8ab040e872565f50cfe8e4a492c3058bbb51a1f.png",
    "w": 472,
    "h": 600,
    "face": {
     "x": 0.3411,
     "y": 0.2883,
     "w": 0.2225,
     "h": 0.175
    }
   },
   {
    "label": "说话",
    "src": "6d/6d5d5b9fb7bbf1ae1cbe5dbf688ff10b3ed96d45848c8f7a7855ddc02669dfb5.png",
    "w": 472,
    "h": 600,
    "face": {
     "x": 0.3432,
     "y": 0.2917,
     "w": 0.214,
     "h": 0.1683
    }
   },
   {
    "label": "认真",
    "src": "e0/e0298f77001d486c1df9199f4d254be26236f07eb958ef9ad8f8e9a2f4d3d3e6.png",
    "w": 472,
    "h": 600,
    "face": {
     "x": 0.339,
     "y": 0.2867,
     "w": 0.2246,
     "h": 0.1767
    }
   },
   {
    "label": "担心",
    "src": "3b/3be69b9aaa06318144227e0e030ead28c01e4cbb52b2957eedd5f5552724261d.png",
    "w": 472,
    "h": 600,
    "face": {
     "x": 0.3369,
     "y": 0.2867,
     "w": 0.2246,
     "h": 0.1767
    }
   }
  ],
  "scenes": [
   {
    "label": "校园",
    "src": "f1/f1198e9a72940a65bfded78cbf6603a8366afbc6423940260ea86cfcf6050390.jpg",
    "focus": 50
   },
   {
    "label": "教室",
    "src": "d8/d8f477d6022ec8d409985e6d6c4a9dfc03f8671b98caaa587c134ba3f24fb915.jpg",
    "focus": 50
   },
   {
    "label": "活动室",
    "src": "7e/7e4e1a20a93fa4378603bcf6f980415edf9a2ebd8e3cb084893d0adbf1d75a01.jpg",
    "focus": 50
   },
   {
    "label": "草地",
    "src": "eb/eb0e5ed08abe8906c78861ea9cf39566f9214a0fad15f88512824e2d83e1ffa8.jpg",
    "focus": 50
   }
  ]
 },
 {
  "name": "林翩翩",
  "work": "哀鸿",
  "tags": [
   "日语配音",
   "本地测试",
   "视觉小说",
   "古风"
  ],
  "sprites": [
   {
    "label": "微笑",
    "src": "67/675bac874b48d3c972ecaba7b0641f5185c4fe09d50c65627ce6996b35c3e3c7.png",
    "w": 580,
    "h": 1071,
    "face": {
     "x": 0.3838,
     "y": 0.084,
     "w": 0.3351,
     "h": 0.1816
    }
   },
   {
    "label": "开心",
    "src": "c8/c81b6e4d8ab45e589344e5d0d9495ffdce663a1c352c850c62d08781ea5d2515.png",
    "w": 580,
    "h": 1071,
    "face": {
     "x": 0.3838,
     "y": 0.083,
     "w": 0.3387,
     "h": 0.1836
    }
   },
   {
    "label": "兴奋",
    "src": "ba/ba875729167f3af9f3b17612d036648b37e856781594040264fdb584ca83cdaf.png",
    "w": 580,
    "h": 1071,
    "face": {
     "x": 0.382,
     "y": 0.0801,
     "w": 0.3441,
     "h": 0.1865
    }
   },
   {
    "label": "不好意思",
    "src": "8e/8e6e1e769db727fc8153f1ead9867729e48447a6c5c743c5a4a9d74047967ff0.png",
    "w": 580,
    "h": 1071,
    "face": {
     "x": 0.3856,
     "y": 0.0859,
     "w": 0.3297,
     "h": 0.1787
    }
   },
   {
    "label": "幽怨",
    "src": "3b/3b0e7e64d39df96f9969a42862870e2927d39946ea75c75e1e3055e83e0d3e28.png",
    "w": 580,
    "h": 1071,
    "face": {
     "x": 0.3874,
     "y": 0.0879,
     "w": 0.3243,
     "h": 0.1758
    }
   },
   {
    "label": "钦佩",
    "src": "b7/b7ec34fea0577fd80546aef09d1d36a8675b59fec92d73486c69345eff925aa0.png",
    "w": 580,
    "h": 1071,
    "face": {
     "x": 0.3802,
     "y": 0.082,
     "w": 0.3387,
     "h": 0.1836
    }
   }
  ],
  "scenes": [
   {
    "label": "庭院",
    "src": "77/77497374dd1bf359459abb0a9305d325c4f8c5a10a03984bc598cc25b51c6d74.jpg",
    "focus": 50
   },
   {
    "label": "庭院夜",
    "src": "95/95bbab2bc14e60791cfe4b2bcea6a538b479dadbca42a0194e5e208ac20851c0.jpg",
    "focus": 50
   },
   {
    "label": "雨天庭院",
    "src": "b7/b7c29687ec5581c827729a43065fe3b5e573a47b8d76ead496aed694925ad291.jpg",
    "focus": 50
   },
   {
    "label": "卧房",
    "src": "4f/4f332df2569a0b857ea42991e0527898932216196083063c5a9b045548e7b8a3.jpg",
    "focus": 45
   },
   {
    "label": "卧房夜",
    "src": "53/538f89236d76e5dd3d70becca95b7d2096ee2ab4d9d4299a2c71c0a0c3ebece6.jpg",
    "focus": 45
   },
   {
    "label": "茶舍",
    "src": "d4/d40296882216376a54ce80a07da65b96e1e29a1cec23897f0165fae8aeb612c2.jpg",
    "focus": 50
   }
  ]
 }
];

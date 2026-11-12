# Ginger 3D 模型制作规格

## 角色外观（以用户上传的仓鼠参考图为准）
- 极度圆润、矮胖的金黄色仓鼠，脸颊特别饱满，身体短圆。
- 奶油色口鼻和腹部；粉色耳朵、鼻子、爪子；大而亮的黑眼睛；两颗小门牙。
- 毛发非常蓬松，能看见一根根有长短层次的细毛；不要做成光滑塑料玩具。
- 保留参考图的比例与可爱表情，不要改成真实比例的瘦小仓鼠。

## 交付格式
- 文件：`public/models/ginger.glb`
- 建议目标：10 MB 以内，优先保证 iPad Safari 加载性能。
- GLB 内嵌材质、贴图、骨骼和动画。
- 毛发建议优化 Hair Cards / 毛发纹理结合少量几何毛发；避免海量独立毛发几何体。
- 角色脚底落地，模型中心接近原点；网页加载器会自动归一化尺寸。

## 骨骼与表情
建议骨骼：`Root`, `Body`, `Head`, `Ear.L`, `Ear.R`, `Arm.L`, `Arm.R`, `Leg.L`, `Leg.R`, `Jaw`。
建议提供眨眼 Shape Keys：`Blink.L`, `Blink.R`；说话嘴型可用 `MouthOpen` morph target 或 Jaw 骨骼。

## 必需动画 Clip 名称
`Idle`, `Wave`, `Jump`, `Dance`, `RunWheel`, `Eat`, `Talk`, `Sleep`, `Celebrate`。
Idle / RunWheel / Talk / Sleep 可循环；其他动作建议单次播放并自然回到 Idle。

## 网页集成
项目使用 Three.js 0.187.0。`public/ginger-pet.js` 提供兼容层，维持现有 `play(action)`、`setTalking(on)`、`lookToward(x,y)`、`update(t)` 接口。只要将模型放入 `public/models/ginger.glb`，网页即可尝试加载；未提供模型时会自动回退原有程序仓鼠。

## 验收标准
1. 桌面 Chrome、Safari 和 iPad Safari 可加载。
2. GLB 缺失或加载失败时，旧仓鼠仍正常显示。
3. Idle、Wave、Dance、Jump、Eat、Talk 动作可切换且过渡自然。
4. 毛发在正面、侧面和背光下有层次，不遮挡眼睛、鼻子和嘴巴。
5. 外观比例与用户参考图一致。

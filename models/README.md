# 离线翻译模型文件

请将对应语言对的模型文件放入对应目录。

## 获取方式

### 方式一：运行下载脚本（推荐）

```powershell
# 需要先开 VPN/代理
powershell -File download-models.ps1
```

### 方式二：手动下载

从 HuggingFace 下载每个语言对的以下文件，放入对应目录：

```
models/zh-en/  (中→英)
  config.json, tokenizer.json, tokenizer_config.json,
  source.spm, target.spm, vocab.json
  onnx/encoder_model_quantized.onnx
  onnx/decoder_model_merged_quantized.onnx

models/en-zh/  (英→中)
  ...同上结构...

models/en-ja/  (英→日)
  ...同上结构...
```

### 方式三：从已有网站复制

如果 `harisnae.github.io/multilingual-translator-offline` 可访问，
可直接从其模型目录复制文件。

## 模型来源

| 语言对 | HuggingFace 模型 ID | 大小 |
|---|---|---|
| zh→en | Xenova/opus-mt-zh-en | ~80MB |
| en→zh | Xenova/opus-mt-en-zh | ~80MB |
| en→ja | Xenova/opus-mt-en-jap | ~80MB |

上传到 GitHub Pages 后，App 从同源加载模型，不走外部 CDN。

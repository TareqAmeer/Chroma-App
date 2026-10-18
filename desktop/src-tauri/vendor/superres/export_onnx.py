import torch, torch.nn as nn, torch.nn.functional as F
class SRVGGNetCompact(nn.Module):
    def __init__(self, num_in_ch=3, num_out_ch=3, num_feat=64, num_conv=16, upscale=4):
        super().__init__()
        self.upscale = upscale
        self.body = nn.ModuleList()
        self.body.append(nn.Conv2d(num_in_ch, num_feat, 3, 1, 1))
        self.body.append(nn.PReLU(num_parameters=num_feat))
        for _ in range(num_conv):
            self.body.append(nn.Conv2d(num_feat, num_feat, 3, 1, 1))
            self.body.append(nn.PReLU(num_parameters=num_feat))
        self.body.append(nn.Conv2d(num_feat, num_out_ch * upscale * upscale, 3, 1, 1))
        self.upsampler = nn.PixelShuffle(upscale)
    def forward(self, x):
        out = x
        for l in self.body: out = l(out)
        out = self.upsampler(out)
        return out + F.interpolate(x, scale_factor=self.upscale, mode='nearest')
sd = torch.load('x4v3.pth', map_location='cpu')
sd = sd.get('params', sd)
nconv = (max(int(k.split('.')[1]) for k in sd if k.startswith('body.')) - 2) // 2
print('keys', len(sd), 'num_conv', nconv)
m = SRVGGNetCompact(num_conv=nconv); m.load_state_dict(sd, strict=True); m.eval()
x = torch.rand(1, 3, 64, 64)
torch.onnx.export(m, x, 'realesr-general-x4v3.onnx', input_names=['input'], output_names=['output'],
                  dynamic_axes={'input': {2: 'h', 3: 'w'}, 'output': {2: 'H', 3: 'W'}}, opset_version=17)
torch.save(m.state_dict(), 'check.pt')
y = m(x); print('out', tuple(y.shape), float(y.min()), float(y.max()))

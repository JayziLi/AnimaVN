"""素材(立绘、背景 / 音乐 / CG、声音)共用的东西。

common.py 是三种素材共用的校验:名字的规矩、图片大小上限、按文件头认图片格式;
接口在 app/api/sprites.py、app/api/scenes.py、app/api/voices.py。
lbpcascade_animeface.xml 是立绘找脸用的模型文件(app/sprite_faces.py 读它)。
"""

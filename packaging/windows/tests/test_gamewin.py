import gamewin as G

# 这台笔记本的样子:4K 主屏 150%,左边还有一块
MAIN = G.Screen((0, 0, 3840, 2160), (0, 0, 3840, 2088))
LEFT = G.Screen((-3840, 0, 3840, 2160), (-3840, 0, 3840, 2088))
FRAME = (22, 56)  # 150% 下边框 + 标题栏


def client(args, scale=1.5, frame=FRAME):
    """pywebview 会把 width/height 乘回去当外框;无边框时去掉边框"""
    w, h = int(args["width"] * scale), int(args["height"] * scale)  # 和 pywebview 一样取整
    return w - frame[0], h - frame[1]


def test_pick_screen_by_mouse_then_main():
    assert G.pick_screen([LEFT, MAIN], (100, 100)) == MAIN
    assert G.pick_screen([LEFT, MAIN], (-100, 100)) == LEFT
    assert G.pick_screen([LEFT, MAIN], (99999, 0)) == MAIN  # 不在任何一块上:主屏
    assert G.pick_screen([LEFT], (99999, 0)) == LEFT


def test_window_gets_exact_picture_size_and_centers():
    a = G.window_args("window", "1920x1080", MAIN, 1.5, FRAME)
    assert client(a) == (1920, 1080)
    assert a["resizable"] and not a["frameless"] and not a["fullscreen"]
    # 外框在可用区域里居中
    x, w = a["x"] * 1.5, a["width"] * 1.5
    assert abs(x + w / 2 - 1920) <= 2


def test_borderless_full_size_covers_the_screen():
    a = G.window_args("borderless", "3840x2160", MAIN, 1.5, FRAME)
    assert a["frameless"] and not a["resizable"]
    assert client(a) == (3840, 2160)
    assert (int(a["x"] * 1.5), int(a["y"] * 1.5)) == (0, 0)


def test_too_big_shrinks_keeping_16_9():
    small = G.Screen((0, 0, 1920, 1080), (0, 0, 1920, 1032))
    a = G.window_args("window", "2560x1440", small, 1.0, (16, 39))
    w, h = client(a, 1.0, (16, 39))
    assert h <= 1032 - 39 and w <= 1920 - 16
    assert abs(w / h - 16 / 9) < 0.01
    b = G.window_args("borderless", "2560x1440", small, 1.0, (16, 39))
    assert client(b, 1.0, (16, 39)) == (1920, 1080)


def test_fullscreen_remembers_a_window_size_for_f11():
    a = G.window_args("fullscreen", "1600x900", LEFT, 1.5, FRAME)
    assert a["fullscreen"] and not a["frameless"]
    assert client(a) == (1600, 900)
    assert a["x"] * 1.5 < 0  # 开在左边那块上,全屏也全在那块

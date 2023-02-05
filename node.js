import * as jsc from './jsc.js';
import fs from 'fs';
import child_process from 'child_process';

const tests = {
    _out0(){debug('Hello world')},

    _out1(){
        x={y:1, z(){}, x}
    },

    _out2(){
        function d(a, b = 2){
            return a + b * 2;
        }
        debug('bacon' + d(3, 7))
    },

    _out3(){
        function b(){
            var a = function(){
                for(let i = 0; i < 10; ++i) {
                    this.x = i;
                    debug('I:', i, i == '5');
                }
            }
            a();
        }
        b();
    },

    _out4(){
        let x = 10;
        while(x){
            debug(x--);
        }
    },

    _out5(){
        if (5 > 2) {
            debug("1");
        } else {
            debug("wat");
        }
        debug("2");
        if (42) {
            debug(3);
        }
        if (0) {
            debug("eh");
        } else {
            debug(4);
        }
    },

    _out6(){
        var v = 2;
        v += 2;
        debug(v);
        v -= 5;
        debug(v);
    },

    _out7(){
        var v = [5, 6, 7];
        debug(v);
    },

    _out8(){
        var v = {a:1, b:32};
        debug(v);
    },

    _out9() {
        function OldStyleClass(mul) {
            this.x = 42;
            this.incX = function(){
                debug(this.x);
                outer: for (;;) {
                    for (let i = 1; i < 4; ++i) {
                        this.x += i * mul;
                        debug(this.x, i, mul);
                        break outer;
                    }
                }
            };
        }

        function bob(a){
            debug(this.x);
            return function(b){return a + 1 + b;};
        }

        var v = {
            x:"ok",
            y:bob,
            z(){debug("hey", this.y(2)(7))}
        };

        bob(1);
        let vy = new OldStyleClass(5);
        vy.incX();
        debug("42=", vy);
        v.z();
    },

    _out10() {
        const x = new Array(8);
        for (let i = 0; i < x.length; ++i) {
            x[i] = i * 3;
        }
        debug(x);
    },

    _out11() {
        "addSysCall setTexture setBacon";

        class Bacon {
            constructor() {
                this.x = 10;
            }
        }
        var bacon = new Bacon();
        debug(bacon.x);
    },

    _out12() {
        if (1 || 0) {
            debug("in");
        }
    },

    _out() {
        var x = [8, 4, 6, 3, 19];
        for (var i of x) {
            debug(i);
        }
    },

    _out() {
        function add(a){
            return b => a + b;
        }
        const v = add(3);
        debug(v(2))
    },

    _template(){
        "set platform espboy";
        "addSysCall setScreenMode setPen setFont setLED setTexture setMirrored setFlipped";
        "addSysCall getWidth getHeight";
        "addSysCall clear image text";
        "push globals UP DOWN LEFT RIGHT A B C D";

        function init() {
        }

        function update() {
        }

        function render() {
        }
    },

    _input(){
        "set platform espboy";
        "addSysCall setScreenMode setPen setFont setLED setTexture setMirrored setFlipped";
        "addSysCall getWidth getHeight";
        "addSysCall clear image text";
        "push globals UP DOWN LEFT RIGHT A B C D";

        var buttons;

        function init() {
            setFont(R.fontDragon);
        }

        function update() {
            buttons = ">";
            if (D) buttons += " D";
            if (C) buttons += " C";
            if (B) buttons += " B";
            if (A) buttons += " A";
            if (RIGHT) buttons += " RIGHT";
            if (LEFT) buttons += " LEFT";
            if (DOWN) buttons += " DOWN";
            if (UP) buttons += " UP";
        }

        function render() {
            setPen(100, 100, 200);
            clear();
            setPen(255, 0, 0);
            text(buttons);
        }
    },

    moveSprite(){
        "set platform espboy";
        "addSysCall setScreenMode setPen setFont setLED setTexture";
        "addSysCall setMirrored setFlipped setTransparent setRecolor";
        "addSysCall getWidth getHeight";
        "addSysCall clear image text";
        "push globals UP DOWN LEFT RIGHT A B C D";

        {"ifeq platform blit";
         setScreenMode("lores");
         setFont("minimal_font");
        }

        const batFly = [R.bat2, R.bat3, R.bat4];

        const width = getWidth();
        const height = getHeight();

        const bgHeight = getHeight(R.background);
        const bgWidth = getWidth(R.background);

        let x = bgWidth / 2;
        let y = bgHeight / 2;
        let c = 0.1;

        let cameraX = x + 0.01;
        let cameraY = 0.01;

        let frames = 0;
        let start = 0;
        let fps = 0;
        let recolor = 0;

        function init() {
        }

        function update(time) {
            frames++;
            if (time - start > 1000) {
                fps = frames;
                frames = 0;
                start = time;
            }

            if (A)
                setRecolor(recolor = rand(0xFF));

            x += RIGHT - LEFT;
            y += DOWN - UP;
            cameraX = (cameraX * 15 + (x - width/2)) / 16;
            cameraY = (cameraY * 15 + (y - height/2)) / 16;
            cameraY = max(height - bgHeight, cameraY);
        }

        function render() {
            setPen(200, 100, 100);
            clear();

            setMirrored(false);
            setFlipped(false);
            setTransparent(false);

            image(R.background, -cameraX, -cameraY);

            setMirrored((c * 10) & 32);
            setFlipped((c * 10) & 64);
            image(batFly[(c|0)%batFly.length], x - cameraX, y - cameraY, c * 0.1);
            c += 0.1;

            setLED(x, y, 0);

            setPen(0, 0, 0);
            text(fps + " rc:" + recolor, 5, 5);
        }
    },

    _bounce(){
        "set platform blit";
        "addSysCall setScreenMode setPen setFont setLED setTexture setMirrored setFlipped";
        "addSysCall getWidth getHeight";
        "addSysCall clear image text";
        "push globals UP DOWN LEFT RIGHT A B C D";

        let c = 0.1;
        let sw;
        let sh;
        let w = getWidth(R.Smile);
        let h = getHeight(R.Smile);
        const bounce = new Array(30);

        class Bounce {
            constructor(i) {
                this.x = i * 7.8;
                this.y = i * 3.8;
                this.vx = (i - 2.5) * 0.7;
                this.vy = 0;
                debug("Bounce ", i);
            }

            update() {
                this.x += this.vx;
                this.y += this.vy;

                if ((this.x + w > sw && this.vx > 0) || (this.x < 0 && this.vx < 0)) {
                    this.vx = -this.vx;
                }

                if ((this.y + h > sh && this.vy > 0) || (this.y < 0 && this.vy < 0)) {
                    this.vy = -this.vy;
                    if (this.y + h > sh)
                        this.y = sh - h;
                }

                this.vy += 0.13;
            }

            render() {
                setMirrored(this.vx < 0);
                setFlipped(this.vy < 0);
                image(this.x, this.y);
            }
        }

        function init() {
            {"ifeq platform blit";
             setScreenMode("hires");
             setFont("minimal_font");
            }
            {"ifneq platform blit";
             setFont(R.fontDragon);
            }
            sw = getWidth();
            sh = getHeight();
            setTexture(R.Smile);
            for (let i = 0, max = bounce.length; i < max; ++i)
                bounce[i] = new Bounce(i);
        }

        function update(tick) {
            for (let b of bounce)
                b.update();
        }

        function render() {
            c += 0.001;
            setPen(c * 13, c * 81, c * 991);
            clear();
            for (let b of bounce)
                b.render();
            setPen(c * 1447, c * 13, c * 77);

            {"ifeq platform blit";
                text("Hello 32Blit!", 5, 4);
            }

            {"ifeq platform pokitto";
                text("Hello Pokitto!", 5, 4);
            }

            {"ifeq platform espboy";
                text("Hello ESPBoy!", 5, 4);
            }
        }
    }
};

for (let k in tests) {
    if (k[0] == '_')
        continue;
    let str = tests[k];
    if (typeof str != 'string')
        str = (str + '').replace(/^[^{]+\{([\s\S]*)\}$/, '$1');
    try {
        test(k, str);
    } catch (ex) {
        console.log(ex);
        break;
    }
}

function test(name, source) {
    let compiler = new jsc.JSC();
    compiler.add(name + ".js", source);

    if (compiler.getOpt('platform') == 'blit') {
        [
            'lores',
            'hires',
            'hires_palette',
            'minimal'
        ].forEach(opt => compiler.push("strings", opt));
    }

    const out = compiler.write("cpp");

    try {
        if (compiler.getOpt('platform') == 'blit') {
            fs.copyFileSync('js.hpp', '../32Blit/javascript/js.hpp');
            fs.writeFileSync(`../32Blit/javascript/game.cpp`, out, {encoding:'utf-8'});
            // child_process.execSync(`make`, {cwd:'../32Blit/javascript/build'});
            child_process.execSync(`make && ./javascript`, {cwd:'../32Blit/javascript/build-sdl'});
        } else if (compiler.getOpt('platform') == 'pokitto') {
            fs.copyFileSync('js.hpp', '../Pokitto/IDE/projects/JS/js.hpp');
            fs.writeFileSync(`../Pokitto/IDE/projects/JS/game.js`, source, {encoding:'utf-8'});
            fs.writeFileSync(`../Pokitto/IDE/projects/JS/game.cpp`, out, {encoding:'utf-8'});

            // child_process.execSync(`./IDE JS compile - true 0 Pokitto`, {cwd:'../Pokitto/IDE/nwjs-sdk-v0.51.0-linux-x64'});

            child_process.execSync(`./IDE JS compileAndRun - linux`, {cwd:'../Pokitto/IDE/nwjs-sdk-v0.51.0-linux-x64'});
        } else if (compiler.getOpt('platform') == 'espboy') {
            ['assets.hpp', 'assets.cpp', 'bat1.h', 'bat2.h', 'bat3.h', 'bat4.h'].forEach(file => {
                fs.copyFileSync(`../Pokitto/IDE/projects/JS/${file}`, `/home/fmanga/Arduino/ESPboy_FirstTest/${file}`);
            });

            fs.copyFileSync('js.hpp', '/home/fmanga/Arduino/ESPboy_FirstTest/js.hpp');
            fs.writeFileSync(`/home/fmanga/Arduino/ESPboy_FirstTest/game.js`, source, {encoding:'utf-8'});
            fs.writeFileSync(`/home/fmanga/Arduino/ESPboy_FirstTest/game.cpp`, out, {encoding:'utf-8'});

            child_process.execSync(`arduino-builder -compile -logger=machine -hardware /usr/share/arduino/hardware -hardware /home/fmanga/.arduino15/packages -tools /usr/share/arduino/tools-builder -tools /home/fmanga/.arduino15/packages -libraries /home/fmanga/Arduino/libraries -fqbn=esp8266:esp8266:d1_mini:xtal=160,vt=flash,exception=disabled,stacksmash=disabled,ssl=all,mmu=3232,non32xfer=fast,eesz=4M2M,ip=lm2f,dbg=Disabled,lvl=None____,wipe=none,baud=921600 -vid-pid=1A86_7523 -ide-version=10819 -build-path /tmp/arduino_build_308362 -warnings=none -build-cache /tmp/arduino_cache_156407 -prefs=build.warn_data_percentage=75 -prefs=runtime.tools.mklittlefs.path=/home/fmanga/.arduino15/packages/esp8266/tools/mklittlefs/3.0.4-gcc10.3-1757bed -prefs=runtime.tools.mklittlefs-3.0.4-gcc10.3-1757bed.path=/home/fmanga/.arduino15/packages/esp8266/tools/mklittlefs/3.0.4-gcc10.3-1757bed -prefs=runtime.tools.mkspiffs.path=/home/fmanga/.arduino15/packages/esp8266/tools/mkspiffs/3.0.4-gcc10.3-1757bed -prefs=runtime.tools.mkspiffs-3.0.4-gcc10.3-1757bed.path=/home/fmanga/.arduino15/packages/esp8266/tools/mkspiffs/3.0.4-gcc10.3-1757bed -prefs=runtime.tools.xtensa-lx106-elf-gcc.path=/home/fmanga/.arduino15/packages/esp8266/tools/xtensa-lx106-elf-gcc/3.0.4-gcc10.3-1757bed -prefs=runtime.tools.xtensa-lx106-elf-gcc-3.0.4-gcc10.3-1757bed.path=/home/fmanga/.arduino15/packages/esp8266/tools/xtensa-lx106-elf-gcc/3.0.4-gcc10.3-1757bed -prefs=runtime.tools.python3.path=/home/fmanga/.arduino15/packages/esp8266/tools/python3/3.7.2-post1 -prefs=runtime.tools.python3-3.7.2-post1.path=/home/fmanga/.arduino15/packages/esp8266/tools/python3/3.7.2-post1 -verbose /home/fmanga/Arduino/ESPboy_FirstTest/ESPboy_FirstTest.ino`);

            child_process.execSync('/home/fmanga/.arduino15/packages/esp8266/tools/python3/3.7.2-post1/python3 -I /home/fmanga/.arduino15/packages/esp8266/hardware/esp8266/3.0.2/tools/upload.py --chip esp8266 --port /dev/ttyUSB0 --baud 921600 --before default_reset --after hard_reset write_flash 0x0 /tmp/arduino_build_308362/ESPboy_FirstTest.ino.bin');
        } else {
            fs.writeFileSync(name + ".cpp", out, {encoding:'utf-8'});
            child_process.execSync(`g++ -g --std=c++17 ${name}.cpp -o ${name}`)
        }
    } catch (ex) {
        throw `Error building test ${name}: ${ex.output || ex}`;
    }
}

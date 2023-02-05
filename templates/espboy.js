export const espboy = `
#define RESOURCEREF(x) ((js::ResourceRef*)res::x)
#define RESOURCEDECL(x) const uint8_t PROGMEM x[]
#define PRINT(str) Serial.print((const char*)str)
#define PRINTLN() Serial.print("\\n");
#define STRDECL(VAR, LEN, STR) __attribute__ ((aligned)) const std::array<uint8_t, sizeof(js::Buffer) + LEN> VAR = js::bufferFrom<LEN>(STR);
$[[minStringTable]]

#include "espboy.hpp"

namespace res {
$[[resources]]
}

$[[translated]]

void JSinit() {
  {
    js::Local args = js::arguments(0);
    js::call($[[main]], args, false);
    js::call($[[init]], args, false);
  }
  js::gc();
}

void JSupdate(uint32_t time, uint32_t updateCount) {
  {
    js::Local args = js::arguments(1);
    js::set(args, V_0, time);
    for (uint32_t i = 0; i < updateCount; ++i)
      js::call($[[update]], args, false);
    js::call($[[render]], args, false);
  }
}
`

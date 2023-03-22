export const galuni = `
#define RESOURCEREF(x) ((js::ResourceRef*)res::x)
#define RESOURCEDECL_T(T, x) const T x[]
#define RESOURCEDECL(x) RESOURCEDECL_T(uint8_t, x)
#define PRINT(str) do {} while (0)
#define PRINTLN() do {} while (0)
#define STRDECL(VAR, LEN, STR) __attribute__ ((aligned)) const std::array<uint8_t, sizeof(js::Buffer) + LEN> VAR = js::bufferFrom<LEN>(STR);

$[[minStringTable]]

#include "galuni.h"

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

void JSrender(uint32_t time) {
  PROFILER;
  js::Local args = js::arguments(1);
  js::set(args, V_0, time);
  js::call($[[render]], args, false);
}

void JSupdate(uint32_t time, uint32_t updateCount) {
  PROFILER;
  {
    js::Local args = js::arguments(1);
    js::set(args, V_0, time);
    for (uint32_t i = 0; i < updateCount; ++i)
      js::call($[[update]], args, false);
  }
}
`;
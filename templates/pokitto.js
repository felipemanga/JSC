export const pokitto = `
#define RESOURCEREF(x) ((js::ResourceRef*)resource::x)
#define RESOURCEDECL_T(T, x) const T x[]
#define RESOURCEDECL(x) RESOURCEDECL_T(uint8_t, x)
#define PRINT(str) LOG((const char*)(str))
#define PRINTLN() LOG("\\n");
#define STRDECL(VAR, LEN, STR) __attribute__ ((aligned)) const std::array<uint8_t, sizeof(js::Buffer) + LEN> VAR = js::bufferFrom<LEN>(STR);

$[[minStringTable]]

#include "api.h"

namespace resource {
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

void JSupdate() {
  {
    js::Local args = js::arguments(1);
    js::set(args, V_0, Pokitto::Core::getTime());
    js::call($[[update]], args, false);
    js::call($[[render]], args, false);
  }
}
`;

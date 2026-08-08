package protocol

import "testing"

func TestCodec12CommandRoundTrip(t *testing.T) {
	cmds := []string{"setdigout 1?", "setdigout ?1", "getinfo", "cpureset", "setparam 2004:tcp.penny.rent"}
	for _, cmd := range cmds {
		t.Run(cmd, func(t *testing.T) {
			frame := BuildCommand(cmd)
			typ, payload, err := ParseCodec12(frame)
			if err != nil {
				t.Fatalf("ParseCodec12: %v", err)
			}
			if typ != Codec12TypeCommand {
				t.Fatalf("type = 0x%02X, want command 0x05", typ)
			}
			if payload != cmd {
				t.Fatalf("payload = %q, want %q", payload, cmd)
			}
		})
	}
}

func TestCodec12ResponseRoundTrip(t *testing.T) {
	frame := BuildResponse("setdigout 1?:OK")
	typ, payload, err := ParseCodec12(frame)
	if err != nil {
		t.Fatalf("ParseCodec12: %v", err)
	}
	if typ != Codec12TypeResponse {
		t.Fatalf("type = 0x%02X, want response 0x06", typ)
	}
	if payload != "setdigout 1?:OK" {
		t.Fatalf("payload = %q", payload)
	}
}

func TestCodec12BadCRC(t *testing.T) {
	frame := BuildCommand("getinfo")
	frame[len(frame)-1] ^= 0xFF
	if _, _, err := ParseCodec12(frame); err != ErrCRC {
		t.Fatalf("want ErrCRC, got %v", err)
	}
}

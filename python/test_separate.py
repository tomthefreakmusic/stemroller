import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import numpy as np
import torch
from separate import demix


class IdentityFour(torch.nn.Module):
    def forward(self, x):
        return x[:, None].expand(-1, 4, -1, -1)


class ChunkingTests(unittest.TestCase):
    def test_identity_reconstruction_at_boundaries_and_short_lengths(self):
        # Tests the actual overlap-add math independently of neural model quality.
        for length in [1, 100, 1600, 4000, 8101]:
            for overlap in [2, 4]:
                torch.manual_seed(length)
                signal = torch.rand(2, length) * 2 - 1
                result = demix(IdentityFour(), signal, 2000, overlap, torch.device('cpu'))
                self.assertEqual(result.shape, (4, 2, length))
                np.testing.assert_allclose(result, np.broadcast_to(signal.numpy(), result.shape), atol=2e-7)

    def test_nonfinite_prediction_rejected(self):
        class Broken(torch.nn.Module):
            def forward(self, x):
                return torch.full((1, 4, 2, x.shape[-1]), float('nan'))
        with self.assertRaisesRegex(ValueError, 'non-finite'):
            demix(Broken(), torch.zeros(2, 1000), 2000, 2, torch.device('cpu'))


if __name__ == '__main__':
    unittest.main()

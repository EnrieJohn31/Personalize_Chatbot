<?php

namespace App\Data\Agent;

use InvalidArgumentException;

/** The signed snapshot cannot fit the engine's request body limit. */
final class RunRequestTooLarge extends InvalidArgumentException {}
